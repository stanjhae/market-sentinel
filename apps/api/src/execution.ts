import type { ExecutionConfirm, ExecutionPreview, ExecutionStatus, RiskEvaluationDto } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import type { Env } from "@market-sentinel/config";
import { auditLogs, brokerOrders, brokerPositions, instruments, signals, tradePlans, type Database } from "@market-sentinel/db";
import {
  assertDemoExecutionAllowed,
  buildDemoOpenBody,
  classifyLookupStatus,
  createRequestId,
  findOpenInPnl,
  findPositionInPnl,
  type DemoCostBreakdown,
  type DemoOpenOrderBody,
  type ExecutionSendResult,
  type EtoroDemoExecutionClient,
} from "@market-sentinel/etoro-client";
import { Decimal } from "decimal.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { nonceSecret, PREVIEW_TTL_MS, signPreviewNonce, verifyPreviewNonce, type PreviewNoncePayload } from "./execution-nonce.js";
import { evaluateStoredPlan } from "./risk.js";

export type ExecutionDeps = {
  db: Database;
  redis: Redis;
  env: Env;
  client: EtoroDemoExecutionClient | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pnlWaitMs?: number;
};

export const ACTIVE_EXECUTION_STATUSES = ["PENDING", "FILLED", "AMBIGUOUS"] as const;

type BrokerOrderRow = typeof brokerOrders.$inferSelect;

export function executionStatusFromEnv(args: { env: Env }): ExecutionStatus {
  const blockReasons: string[] = [];
  if (args.env.ETORO_ACCOUNT_TYPE !== "demo") {
    blockReasons.push("account-type-not-demo");
  }
  if (!args.env.DEMO_EXECUTION_ENABLED) {
    blockReasons.push("demo-execution-disabled");
  }
  if (!args.env.APP_PASSWORD) {
    blockReasons.push("app-password-required");
  }
  return {
    allowed: blockReasons.length === 0,
    accountType: args.env.ETORO_ACCOUNT_TYPE,
    enabled: args.env.DEMO_EXECUTION_ENABLED,
    blockReasons,
  };
}

export function canMintNewExecution(args: { existingStatus?: string | null }): boolean {
  if (!args.existingStatus) {
    return true;
  }
  return args.existingStatus === "REJECTED";
}

export function shouldPostOnConfirm(args: {
  existing: { status: string; rawResponseJson: unknown; etoroOrderId: string | null } | null;
}): boolean {
  if (!args.existing) {
    return true;
  }
  if (args.existing.status !== "PENDING") {
    return false;
  }
  if (args.existing.etoroOrderId) {
    return false;
  }
  return args.existing.rawResponseJson == null;
}

export function isUniqueViolation(args: { error: unknown }): boolean {
  let current: unknown = args.error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export function amountsBoundToPlan(args: {
  nonceAmount: string;
  planAmount: string | null;
  nonceStop: string | null | undefined;
  planStop: string | null;
  nonceTarget: string | null | undefined;
  planTarget: string | null;
  nonceInstrumentId: number;
  planInstrumentId: number;
}): boolean {
  if (!args.planAmount) {
    return false;
  }
  try {
    if (!new Decimal(args.nonceAmount).eq(new Decimal(args.planAmount))) {
      return false;
    }
  } catch {
    return false;
  }
  if (normalizeRate({ value: args.nonceStop }) !== normalizeRate({ value: args.planStop })) {
    return false;
  }
  if (normalizeRate({ value: args.nonceTarget }) !== normalizeRate({ value: args.planTarget })) {
    return false;
  }
  return args.nonceInstrumentId === args.planInstrumentId;
}

export async function writeAudit(args: {
  db: Database;
  eventType: string;
  requestId?: string;
  instrumentId?: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await args.db.insert(auditLogs).values({
    id: randomUUID(),
    eventType: args.eventType,
    requestId: args.requestId,
    instrumentId: args.instrumentId,
    payloadJson: args.payload,
  });
}

export async function reconcileOpenOrder(args: {
  client: EtoroDemoExecutionClient;
  requestId: string;
  referenceId: string;
  instrumentId: number;
  etoroOrderId?: number;
  sleep?: (ms: number) => Promise<void>;
  pnlWaitMs?: number;
}): Promise<{ status: "FILLED" | "REJECTED" | "AMBIGUOUS"; etoroOrderId?: string; positionId?: string }> {
  try {
    const lookup = await args.client.lookupOrder({
      requestId: createRequestId(),
      orderId: args.etoroOrderId,
      referenceId: args.etoroOrderId === undefined ? args.referenceId : undefined,
    });
    const classified = classifyLookupStatus({ statusId: lookup.status?.id });
    if (classified === "FILLED") {
      return {
        status: "FILLED",
        etoroOrderId: lookup.orderId !== undefined ? String(lookup.orderId) : args.etoroOrderId !== undefined ? String(args.etoroOrderId) : undefined,
        positionId: lookup.positionExecutions?.[0]?.positionId !== undefined ? String(lookup.positionExecutions[0].positionId) : undefined,
      };
    }
    if (classified === "REJECTED") {
      return { status: "REJECTED", etoroOrderId: lookup.orderId !== undefined ? String(lookup.orderId) : undefined };
    }
  } catch {
    // fall through to PnL
  }
  const wait = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  await wait(args.pnlWaitMs ?? 10_000);
  try {
    const pnl = await args.client.getDemoPnl({ requestId: createRequestId() });
    const found = findOpenInPnl({ pnl, instrumentId: args.instrumentId, orderId: args.etoroOrderId });
    if (found.found) {
      return {
        status: "FILLED",
        etoroOrderId: found.orderId !== undefined ? String(found.orderId) : undefined,
        positionId: found.positionId !== undefined ? String(found.positionId) : undefined,
      };
    }
  } catch {
    // still unknown
  }
  return { status: "AMBIGUOUS" };
}

export async function reconcileCloseOrder(args: {
  client: EtoroDemoExecutionClient;
  positionId: string;
  etoroOrderId?: string | null;
  sleep?: (ms: number) => Promise<void>;
  pnlWaitMs?: number;
}): Promise<{ status: "FILLED" | "REJECTED" | "AMBIGUOUS"; etoroOrderId?: string }> {
  if (args.etoroOrderId) {
    try {
      const closeInfo = await args.client.getCloseOrder({ requestId: createRequestId(), orderId: args.etoroOrderId });
      const classified = classifyLookupStatus({ statusId: closeInfo.orderForClose?.statusID });
      if (classified === "FILLED") {
        return { status: "FILLED", etoroOrderId: args.etoroOrderId };
      }
      if (classified === "REJECTED") {
        return { status: "REJECTED", etoroOrderId: args.etoroOrderId };
      }
    } catch {
      // fall through to PnL
    }
  }
  const wait = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  await wait(args.pnlWaitMs ?? 10_000);
  try {
    const pnl = await args.client.getDemoPnl({ requestId: createRequestId() });
    if (!findPositionInPnl({ pnl, positionId: args.positionId })) {
      return { status: "FILLED", etoroOrderId: args.etoroOrderId ?? undefined };
    }
  } catch {
    // still unknown
  }
  return { status: "AMBIGUOUS", etoroOrderId: args.etoroOrderId ?? undefined };
}

function parsePositiveAmount(args: { value: string | null | undefined }): string | null {
  if (!args.value) {
    return null;
  }
  try {
    const amount = new Decimal(args.value);
    if (!amount.isFinite() || amount.lte(0)) {
      return null;
    }
    return amount.toString();
  } catch {
    return null;
  }
}

function optionalRate(args: { value: string | null | undefined }): number | undefined {
  if (!args.value) {
    return undefined;
  }
  try {
    const rate = new Decimal(args.value);
    if (!rate.isFinite() || rate.lte(0)) {
      return undefined;
    }
    return rate.toNumber();
  } catch {
    return undefined;
  }
}

function normalizeRate(args: { value: string | null | undefined }): string | null {
  if (args.value === undefined || args.value === null || args.value === "") {
    return null;
  }
  try {
    return new Decimal(args.value).toString();
  } catch {
    return args.value;
  }
}

function isolationStatus(args: { env: Env }): ExecutionStatus {
  try {
    assertDemoExecutionAllowed({
      accountType: args.env.ETORO_ACCOUNT_TYPE,
      enabled: args.env.DEMO_EXECUTION_ENABLED,
      appPassword: args.env.APP_PASSWORD,
    });
  } catch {
    return executionStatusFromEnv({ env: args.env });
  }
  return executionStatusFromEnv({ env: args.env });
}

function emptyPreview(args: { action: "open" | "close"; blockReasons: string[]; evaluation?: RiskEvaluationDto | null }): ExecutionPreview {
  return {
    allowed: false,
    blockReasons: args.blockReasons,
    nonce: null,
    requestId: null,
    action: args.action,
    amount: null,
    instrumentId: null,
    leverage: 1,
    stopLoss: null,
    takeProfit: null,
    costs: [],
    evaluation: args.evaluation ?? null,
  };
}

function mapCosts(args: { costs?: DemoCostBreakdown["costs"] }): ExecutionPreview["costs"] {
  return (args.costs ?? []).flatMap((item) => {
    if (!item?.costType || item.amount === undefined) {
      return [];
    }
    return [{ costType: item.costType, amount: String(item.amount), currency: item.currency ?? "usd" }];
  });
}

function confirmSecret(args: { env: Env }): string {
  return nonceSecret({ appPassword: args.env.APP_PASSWORD, apiKey: args.env.ETORO_API_KEY, userKey: args.env.ETORO_USER_KEY });
}

function blockedConfirm(args: { referenceId?: string | null; blockReasons: string[] }): ExecutionConfirm {
  return {
    status: "BLOCKED",
    orderId: null,
    etoroOrderId: null,
    referenceId: args.referenceId ?? null,
    blockReasons: args.blockReasons,
  };
}

function parseEtoroOrderId(args: { value?: string | null }): number | undefined {
  if (!args.value) {
    return undefined;
  }
  const parsed = Number(args.value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function findOrderByReference(args: { db: Database; referenceId: string }): Promise<BrokerOrderRow | undefined> {
  const rows = await args.db.select().from(brokerOrders).where(eq(brokerOrders.referenceId, args.referenceId)).limit(1);
  return rows[0];
}

async function findActiveOpenForPlan(args: { db: Database; planId: string }): Promise<BrokerOrderRow | undefined> {
  const rows = await args.db
    .select()
    .from(brokerOrders)
    .where(
      and(
        eq(brokerOrders.tradePlanId, args.planId),
        eq(brokerOrders.action, "open"),
        inArray(brokerOrders.status, [...ACTIVE_EXECUTION_STATUSES]),
      ),
    )
    .orderBy(desc(brokerOrders.createdAt))
    .limit(1);
  return rows[0];
}

async function findActiveCloseForPosition(args: { db: Database; positionId: string }): Promise<BrokerOrderRow | undefined> {
  const rows = await args.db
    .select()
    .from(brokerOrders)
    .where(
      and(
        eq(brokerOrders.positionId, args.positionId),
        eq(brokerOrders.action, "close"),
        inArray(brokerOrders.status, [...ACTIVE_EXECUTION_STATUSES]),
      ),
    )
    .orderBy(desc(brokerOrders.createdAt))
    .limit(1);
  return rows[0];
}

export async function previewOpen(args: ExecutionDeps & { planId?: string; signalId?: string }): Promise<
  { http: 200 | 403 | 404 | 409 | 503; body: ExecutionPreview | { error: string } }
> {
  const isolation = isolationStatus({ env: args.env });
  if (!isolation.allowed) {
    await writeAudit({
      db: args.db,
      eventType: "ORDER_ISOLATION_BLOCKED",
      payload: { action: "open", blockReasons: isolation.blockReasons, planId: args.planId, signalId: args.signalId },
    });
    return { http: 403, body: emptyPreview({ action: "open", blockReasons: isolation.blockReasons }) };
  }
  if (!args.client) {
    return { http: 503, body: { error: "etoro credentials missing" } };
  }
  try {
    await args.client.ensureDemoKey();
  } catch {
    await writeAudit({
      db: args.db,
      eventType: "ORDER_ISOLATION_BLOCKED",
      payload: { action: "open", blockReasons: ["key-not-demo"], planId: args.planId },
    });
    return { http: 403, body: emptyPreview({ action: "open", blockReasons: ["key-not-demo"] }) };
  }
  const plan = args.planId
    ? (await args.db.select().from(tradePlans).where(eq(tradePlans.id, args.planId)).limit(1))[0]
    : args.signalId
      ? (
          await args.db
            .select()
            .from(tradePlans)
            .where(and(eq(tradePlans.signalId, args.signalId), eq(tradePlans.gateStatus, "APPROVED")))
            .orderBy(desc(tradePlans.approvedAt))
            .limit(1)
        )[0]
      : undefined;
  if (!plan || plan.gateStatus !== "APPROVED") {
    return { http: 404, body: { error: "approved plan not found" } };
  }
  const active = await findActiveOpenForPlan({ db: args.db, planId: plan.id });
  if (active && !canMintNewExecution({ existingStatus: active.status })) {
    if (active.status === "FILLED") {
      return { http: 409, body: emptyPreview({ action: "open", blockReasons: ["order-already-filled"] }) };
    }
    return resumeOpenPreview({ deps: args, plan, existing: active });
  }
  const signalRows = await args.db.select().from(signals).where(eq(signals.id, plan.signalId)).limit(1);
  const signal = signalRows[0];
  if (!signal) {
    return { http: 404, body: { error: "signal not found" } };
  }
  if (signal.direction !== "LONG" && signal.direction !== "SHORT") {
    return { http: 409, body: emptyPreview({ action: "open", blockReasons: ["direction-not-tradable"] }) };
  }
  const instrumentRows = await args.db.select().from(instruments).where(eq(instruments.id, signal.instrumentId)).limit(1);
  const etoroInstrumentId = instrumentRows[0]?.etoroInstrumentId;
  if (!etoroInstrumentId) {
    return { http: 409, body: emptyPreview({ action: "open", blockReasons: ["instrument-unresolved"] }) };
  }
  const evaluation = await evaluateStoredPlan({
    db: args.db,
    plan: {
      symbol: signal.symbol,
      direction: signal.direction,
      plannedEntry: plan.plannedEntry,
      stopLoss: plan.stopLoss,
      target1: plan.target1,
      riskPct: plan.riskPct,
      riskRewardToT1: signal.riskRewardToT1,
    },
  });
  if (!evaluation.allowed) {
    return { http: 409, body: emptyPreview({ action: "open", blockReasons: evaluation.blockReasons, evaluation }) };
  }
  const amount = parsePositiveAmount({ value: plan.estimatedPositionSize });
  if (!amount) {
    return { http: 409, body: emptyPreview({ action: "open", blockReasons: ["amount-missing"], evaluation }) };
  }
  const requestId = createRequestId();
  const body = buildDemoOpenBody({
    direction: signal.direction,
    instrumentId: etoroInstrumentId,
    amount: new Decimal(amount).toNumber(),
    stopLossRate: optionalRate({ value: plan.stopLoss }),
    takeProfitRate: optionalRate({ value: plan.target1 }),
  });
  let costs: DemoCostBreakdown = {};
  try {
    costs = await args.client.getCosts({ requestId: createRequestId(), body });
  } catch {
    // preview still returns a nonce; costs are best-effort
  }
  const now = args.now?.() ?? Date.now();
  const payload: PreviewNoncePayload = {
    v: 1,
    exp: now + PREVIEW_TTL_MS,
    action: "open",
    planId: plan.id,
    instrumentId: etoroInstrumentId,
    amount,
    stopLoss: plan.stopLoss,
    takeProfit: plan.target1,
    requestId,
  };
  const nonce = signPreviewNonce({
    secret: confirmSecret({ env: args.env }),
    payload,
  });
  await writeAudit({
    db: args.db,
    eventType: "ORDER_PREVIEWED",
    requestId,
    instrumentId: signal.instrumentId,
    payload: { action: "open", planId: plan.id, amount, instrumentId: etoroInstrumentId },
  });
  return {
    http: 200,
    body: {
      allowed: true,
      blockReasons: [],
      nonce,
      requestId,
      action: "open",
      amount,
      instrumentId: etoroInstrumentId,
      leverage: 1,
      stopLoss: plan.stopLoss,
      takeProfit: plan.target1,
      costs: mapCosts({ costs: costs.costs }),
      evaluation,
    },
  };
}

async function resumeOpenPreview(args: {
  deps: ExecutionDeps;
  plan: typeof tradePlans.$inferSelect;
  existing: BrokerOrderRow;
}): Promise<{ http: 200 | 409; body: ExecutionPreview }> {
  const signalRows = await args.deps.db.select().from(signals).where(eq(signals.id, args.plan.signalId)).limit(1);
  const signal = signalRows[0];
  const evaluation = signal
    ? await evaluateStoredPlan({
        db: args.deps.db,
        plan: {
          symbol: signal.symbol,
          direction: signal.direction as "LONG" | "SHORT",
          plannedEntry: args.plan.plannedEntry,
          stopLoss: args.plan.stopLoss,
          target1: args.plan.target1,
          riskPct: args.plan.riskPct,
          riskRewardToT1: signal.riskRewardToT1,
        },
      })
    : null;
  const amount = args.existing.amount ?? parsePositiveAmount({ value: args.plan.estimatedPositionSize });
  if (!amount) {
    return { http: 409, body: emptyPreview({ action: "open", blockReasons: ["amount-missing"], evaluation }) };
  }
  const now = args.deps.now?.() ?? Date.now();
  const nonce = signPreviewNonce({
    secret: confirmSecret({ env: args.deps.env }),
    payload: {
      v: 1,
      exp: now + PREVIEW_TTL_MS,
      action: "open",
      planId: args.plan.id,
      instrumentId: args.existing.instrumentId,
      amount,
      stopLoss: args.plan.stopLoss,
      takeProfit: args.plan.target1,
      requestId: args.existing.referenceId,
    },
  });
  await writeAudit({
    db: args.deps.db,
    eventType: "ORDER_PREVIEWED",
    requestId: args.existing.referenceId,
    instrumentId: signal?.instrumentId,
    payload: { action: "open", planId: args.plan.id, resume: true, orderId: args.existing.id, status: args.existing.status },
  });
  return {
    http: 200,
    body: {
      allowed: true,
      blockReasons: [],
      nonce,
      requestId: args.existing.referenceId,
      action: "open",
      amount,
      instrumentId: args.existing.instrumentId,
      leverage: 1,
      stopLoss: args.plan.stopLoss,
      takeProfit: args.plan.target1,
      costs: [],
      evaluation,
    },
  };
}

export async function confirmOpen(args: ExecutionDeps & { nonce: string }): Promise<
  { http: 200 | 403 | 409 | 503; body: ExecutionConfirm | { error: string } }
> {
  const isolation = isolationStatus({ env: args.env });
  if (!isolation.allowed) {
    await writeAudit({
      db: args.db,
      eventType: "ORDER_ISOLATION_BLOCKED",
      payload: { action: "open", blockReasons: isolation.blockReasons },
    });
    return { http: 403, body: blockedConfirm({ blockReasons: isolation.blockReasons }) };
  }
  const payload = verifyPreviewNonce({
    secret: confirmSecret({ env: args.env }),
    token: args.nonce,
    now: args.now?.() ?? Date.now(),
  });
  if (!payload || payload.action !== "open" || !payload.planId || !payload.amount) {
    return { http: 409, body: { error: "invalid preview nonce" } };
  }
  if (!args.client) {
    return { http: 503, body: { error: "etoro credentials missing" } };
  }
  try {
    await args.client.ensureDemoKey();
  } catch {
    await writeAudit({
      db: args.db,
      eventType: "ORDER_ISOLATION_BLOCKED",
      payload: { action: "open", blockReasons: ["key-not-demo"] },
    });
    return { http: 403, body: blockedConfirm({ referenceId: payload.requestId, blockReasons: ["key-not-demo"] }) };
  }
  const plans = await args.db.select().from(tradePlans).where(eq(tradePlans.id, payload.planId)).limit(1);
  const plan = plans[0];
  if (!plan || plan.gateStatus !== "APPROVED") {
    return { http: 409, body: { error: "approved plan not found" } };
  }
  const signalRows = await args.db.select().from(signals).where(eq(signals.id, plan.signalId)).limit(1);
  const signal = signalRows[0];
  if (!signal || (signal.direction !== "LONG" && signal.direction !== "SHORT")) {
    return { http: 409, body: { error: "signal not tradable" } };
  }
  const existingByRef = await findOrderByReference({ db: args.db, referenceId: payload.requestId });
  if (existingByRef) {
    return finishOpen({
      deps: args,
      order: existingByRef,
      instrumentRowId: signal.instrumentId,
      payload,
      planId: plan.id,
      direction: signal.direction,
    });
  }
  const instrumentRows = await args.db.select().from(instruments).where(eq(instruments.id, signal.instrumentId)).limit(1);
  const etoroInstrumentId = instrumentRows[0]?.etoroInstrumentId;
  if (!etoroInstrumentId) {
    return { http: 409, body: blockedConfirm({ referenceId: payload.requestId, blockReasons: ["instrument-unresolved"] }) };
  }
  if (
    !amountsBoundToPlan({
      nonceAmount: payload.amount,
      planAmount: plan.estimatedPositionSize,
      nonceStop: payload.stopLoss,
      planStop: plan.stopLoss,
      nonceTarget: payload.takeProfit,
      planTarget: plan.target1,
      nonceInstrumentId: payload.instrumentId,
      planInstrumentId: etoroInstrumentId,
    })
  ) {
    return { http: 409, body: blockedConfirm({ referenceId: payload.requestId, blockReasons: ["preview-stale"] }) };
  }
  const evaluation = await evaluateStoredPlan({
    db: args.db,
    plan: {
      symbol: signal.symbol,
      direction: signal.direction,
      plannedEntry: plan.plannedEntry,
      stopLoss: plan.stopLoss,
      target1: plan.target1,
      riskPct: plan.riskPct,
      riskRewardToT1: signal.riskRewardToT1,
    },
  });
  if (!evaluation.allowed) {
    return { http: 409, body: blockedConfirm({ referenceId: payload.requestId, blockReasons: evaluation.blockReasons }) };
  }
  const active = await findActiveOpenForPlan({ db: args.db, planId: plan.id });
  if (active && !canMintNewExecution({ existingStatus: active.status })) {
    return { http: 409, body: blockedConfirm({ referenceId: payload.requestId, blockReasons: ["order-already-active"] }) };
  }
  const openBody: DemoOpenOrderBody = buildDemoOpenBody({
    direction: signal.direction,
    instrumentId: payload.instrumentId,
    amount: new Decimal(payload.amount).toNumber(),
    stopLossRate: optionalRate({ value: payload.stopLoss }),
    takeProfitRate: optionalRate({ value: payload.takeProfit }),
  });
  const orderId = randomUUID();
  try {
    await args.db.insert(brokerOrders).values({
      id: orderId,
      tradePlanId: plan.id,
      action: "open",
      status: "PENDING",
      referenceId: payload.requestId,
      instrumentId: payload.instrumentId,
      amount: payload.amount,
      rawRequestJson: openBody,
    });
  } catch (error) {
    if (!isUniqueViolation({ error })) {
      throw error;
    }
    const raced = await findOrderByReference({ db: args.db, referenceId: payload.requestId });
    if (raced) {
      return finishOpen({
        deps: args,
        order: raced,
        instrumentRowId: signal.instrumentId,
        payload,
        planId: plan.id,
        direction: signal.direction,
      });
    }
    return { http: 409, body: blockedConfirm({ referenceId: payload.requestId, blockReasons: ["order-already-active"] }) };
  }
  return finishOpen({
    deps: args,
    order: {
      id: orderId,
      tradePlanId: plan.id,
      action: "open",
      status: "PENDING",
      etoroOrderId: null,
      referenceId: payload.requestId,
      instrumentId: payload.instrumentId,
      amount: payload.amount,
      positionId: null,
      rawRequestJson: openBody,
      rawResponseJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    instrumentRowId: signal.instrumentId,
    payload,
    planId: plan.id,
    direction: signal.direction,
    inserted: true,
  });
}

async function finishOpen(args: {
  deps: ExecutionDeps;
  order: BrokerOrderRow;
  instrumentRowId: string;
  payload: PreviewNoncePayload;
  planId: string;
  direction: "LONG" | "SHORT";
  inserted?: boolean;
}): Promise<{ http: 200; body: ExecutionConfirm }> {
  const client = args.deps.client as EtoroDemoExecutionClient;
  if (args.order.status === "FILLED" || args.order.status === "REJECTED") {
    return {
      http: 200,
      body: {
        status: args.order.status,
        orderId: args.order.id,
        etoroOrderId: args.order.etoroOrderId,
        referenceId: args.order.referenceId,
        blockReasons: args.order.status === "FILLED" ? [] : [args.order.status.toLowerCase()],
      },
    };
  }
  const openBody: DemoOpenOrderBody = buildDemoOpenBody({
    direction: args.direction,
    instrumentId: args.payload.instrumentId,
    amount: new Decimal(args.payload.amount ?? args.order.amount ?? "0").toNumber(),
    stopLossRate: optionalRate({ value: args.payload.stopLoss }),
    takeProfitRate: optionalRate({ value: args.payload.takeProfit }),
  });
  let sent: ExecutionSendResult<{ orderId?: number }> | undefined;
  if (shouldPostOnConfirm({ existing: args.inserted ? { status: "PENDING", rawResponseJson: null, etoroOrderId: null } : args.order })) {
    await writeAudit({
      db: args.deps.db,
      eventType: "ORDER_SUBMITTED",
      requestId: args.order.referenceId,
      instrumentId: args.instrumentRowId,
      payload: { action: "open", planId: args.planId, orderId: args.order.id },
    });
    sent = await client.createOpenOrder({ requestId: args.order.referenceId, body: openBody });
  }
  const outcome = await settleOpen({
    deps: args.deps,
    orderId: args.order.id,
    requestId: args.order.referenceId,
    instrumentId: args.order.instrumentId,
    sentKind: sent?.kind,
    etoroOrderId: sent?.data?.orderId ?? parseEtoroOrderId({ value: args.order.etoroOrderId }),
    response: sent ?? args.order.rawResponseJson,
    instrumentRowId: args.instrumentRowId,
  });
  await args.deps.redis.set(REDIS_KEYS.forceAccountSync, new Date().toISOString());
  return { http: 200, body: outcome };
}

async function settleOpen(args: {
  deps: ExecutionDeps;
  orderId: string;
  requestId: string;
  instrumentId: number;
  sentKind?: "accepted" | "rejected" | "rate_limited_giveup" | "ambiguous";
  etoroOrderId?: number;
  response: unknown;
  instrumentRowId: string;
}): Promise<ExecutionConfirm> {
  if (args.sentKind === "rejected" || args.sentKind === "rate_limited_giveup") {
    await args.deps.db
      .update(brokerOrders)
      .set({ status: "REJECTED", rawResponseJson: args.response, updatedAt: new Date() })
      .where(eq(brokerOrders.id, args.orderId));
    await writeAudit({
      db: args.deps.db,
      eventType: "ORDER_REJECTED",
      requestId: args.requestId,
      instrumentId: args.instrumentRowId,
      payload: { orderId: args.orderId, kind: args.sentKind },
    });
    return { status: "REJECTED", orderId: args.orderId, etoroOrderId: null, referenceId: args.requestId, blockReasons: [args.sentKind] };
  }
  const reconciled = await reconcileOpenOrder({
    client: args.deps.client as EtoroDemoExecutionClient,
    requestId: args.requestId,
    referenceId: args.requestId,
    instrumentId: args.instrumentId,
    etoroOrderId: args.etoroOrderId,
    sleep: args.deps.sleep,
    pnlWaitMs: args.deps.pnlWaitMs ?? 0,
  });
  const eventType = reconciled.status === "FILLED" ? "ORDER_FILLED" : reconciled.status === "REJECTED" ? "ORDER_REJECTED" : "ORDER_AMBIGUOUS";
  await args.deps.db
    .update(brokerOrders)
    .set({
      status: reconciled.status,
      etoroOrderId: reconciled.etoroOrderId ?? (args.etoroOrderId !== undefined ? String(args.etoroOrderId) : null),
      positionId: reconciled.positionId ?? null,
      rawResponseJson: args.response,
      updatedAt: new Date(),
    })
    .where(eq(brokerOrders.id, args.orderId));
  await writeAudit({
    db: args.deps.db,
    eventType,
    requestId: args.requestId,
    instrumentId: args.instrumentRowId,
    payload: { orderId: args.orderId, status: reconciled.status },
  });
  return {
    status: reconciled.status,
    orderId: args.orderId,
    etoroOrderId: reconciled.etoroOrderId ?? (args.etoroOrderId !== undefined ? String(args.etoroOrderId) : null),
    referenceId: args.requestId,
    blockReasons: reconciled.status === "FILLED" ? [] : [reconciled.status.toLowerCase()],
  };
}

export async function previewClose(args: ExecutionDeps & { positionId: string }): Promise<
  { http: 200 | 403 | 404 | 409 | 503; body: ExecutionPreview | { error: string } }
> {
  const isolation = isolationStatus({ env: args.env });
  if (!isolation.allowed) {
    await writeAudit({
      db: args.db,
      eventType: "ORDER_ISOLATION_BLOCKED",
      payload: { action: "close", blockReasons: isolation.blockReasons, positionId: args.positionId },
    });
    return { http: 403, body: emptyPreview({ action: "close", blockReasons: isolation.blockReasons }) };
  }
  if (!args.client) {
    return { http: 503, body: { error: "etoro credentials missing" } };
  }
  try {
    await args.client.ensureDemoKey();
  } catch {
    await writeAudit({
      db: args.db,
      eventType: "ORDER_ISOLATION_BLOCKED",
      payload: { action: "close", blockReasons: ["key-not-demo"], positionId: args.positionId },
    });
    return { http: 403, body: emptyPreview({ action: "close", blockReasons: ["key-not-demo"] }) };
  }
  const rows = await args.db.select().from(brokerPositions).where(eq(brokerPositions.etoroPositionId, args.positionId)).limit(1);
  const position = rows[0];
  if (!position) {
    return { http: 404, body: { error: "position not found" } };
  }
  const active = await findActiveCloseForPosition({ db: args.db, positionId: position.etoroPositionId });
  const requestId = active && !canMintNewExecution({ existingStatus: active.status }) ? active.referenceId : createRequestId();
  if (active?.status === "FILLED") {
    return { http: 409, body: emptyPreview({ action: "close", blockReasons: ["order-already-filled"] }) };
  }
  const now = args.now?.() ?? Date.now();
  const nonce = signPreviewNonce({
    secret: confirmSecret({ env: args.env }),
    payload: {
      v: 1,
      exp: now + PREVIEW_TTL_MS,
      action: "close",
      positionId: position.etoroPositionId,
      instrumentId: position.instrumentId,
      requestId,
    },
  });
  await writeAudit({
    db: args.db,
    eventType: "ORDER_PREVIEWED",
    requestId,
    payload: { action: "close", positionId: position.etoroPositionId, resume: Boolean(active && active.status !== "REJECTED") },
  });
  return {
    http: 200,
    body: {
      allowed: true,
      blockReasons: [],
      nonce,
      requestId,
      action: "close",
      amount: position.units,
      instrumentId: position.instrumentId,
      leverage: 1,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      costs: [],
      evaluation: null,
    },
  };
}

export async function confirmClose(args: ExecutionDeps & { nonce: string }): Promise<
  { http: 200 | 403 | 409 | 503; body: ExecutionConfirm | { error: string } }
> {
  const isolation = isolationStatus({ env: args.env });
  if (!isolation.allowed) {
    await writeAudit({
      db: args.db,
      eventType: "ORDER_ISOLATION_BLOCKED",
      payload: { action: "close", blockReasons: isolation.blockReasons },
    });
    return { http: 403, body: blockedConfirm({ blockReasons: isolation.blockReasons }) };
  }
  const payload = verifyPreviewNonce({
    secret: confirmSecret({ env: args.env }),
    token: args.nonce,
    now: args.now?.() ?? Date.now(),
  });
  if (!payload || payload.action !== "close" || !payload.positionId) {
    return { http: 409, body: { error: "invalid preview nonce" } };
  }
  if (!args.client) {
    return { http: 503, body: { error: "etoro credentials missing" } };
  }
  try {
    await args.client.ensureDemoKey();
  } catch {
    await writeAudit({
      db: args.db,
      eventType: "ORDER_ISOLATION_BLOCKED",
      payload: { action: "close", blockReasons: ["key-not-demo"] },
    });
    return { http: 403, body: blockedConfirm({ referenceId: payload.requestId, blockReasons: ["key-not-demo"] }) };
  }
  const existingByRef = await findOrderByReference({ db: args.db, referenceId: payload.requestId });
  if (existingByRef) {
    return finishClose({ deps: args, order: existingByRef, positionId: payload.positionId, instrumentId: payload.instrumentId });
  }
  const active = await findActiveCloseForPosition({ db: args.db, positionId: payload.positionId });
  if (active && !canMintNewExecution({ existingStatus: active.status })) {
    return { http: 409, body: blockedConfirm({ referenceId: payload.requestId, blockReasons: ["order-already-active"] }) };
  }
  const orderId = randomUUID();
  try {
    await args.db.insert(brokerOrders).values({
      id: orderId,
      action: "close",
      status: "PENDING",
      referenceId: payload.requestId,
      instrumentId: payload.instrumentId,
      positionId: payload.positionId,
      rawRequestJson: { InstrumentID: payload.instrumentId, UnitsToDeduct: null },
    });
  } catch (error) {
    if (!isUniqueViolation({ error })) {
      throw error;
    }
    const raced = await findOrderByReference({ db: args.db, referenceId: payload.requestId });
    if (raced) {
      return finishClose({ deps: args, order: raced, positionId: payload.positionId, instrumentId: payload.instrumentId });
    }
    return { http: 409, body: blockedConfirm({ referenceId: payload.requestId, blockReasons: ["order-already-active"] }) };
  }
  return finishClose({
    deps: args,
    order: {
      id: orderId,
      tradePlanId: null,
      action: "close",
      status: "PENDING",
      etoroOrderId: null,
      referenceId: payload.requestId,
      instrumentId: payload.instrumentId,
      amount: null,
      positionId: payload.positionId,
      rawRequestJson: { InstrumentID: payload.instrumentId, UnitsToDeduct: null },
      rawResponseJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    positionId: payload.positionId,
    instrumentId: payload.instrumentId,
    inserted: true,
  });
}

async function finishClose(args: {
  deps: ExecutionDeps;
  order: BrokerOrderRow;
  positionId: string;
  instrumentId: number;
  inserted?: boolean;
}): Promise<{ http: 200; body: ExecutionConfirm }> {
  const client = args.deps.client as EtoroDemoExecutionClient;
  if (args.order.status === "FILLED" || args.order.status === "REJECTED") {
    return {
      http: 200,
      body: {
        status: args.order.status,
        orderId: args.order.id,
        etoroOrderId: args.order.etoroOrderId,
        referenceId: args.order.referenceId,
        blockReasons: args.order.status === "FILLED" ? [] : [args.order.status.toLowerCase()],
      },
    };
  }
  let sent: ExecutionSendResult<{ orderForClose?: { orderID?: number } }> | undefined;
  if (shouldPostOnConfirm({ existing: args.inserted ? { status: "PENDING", rawResponseJson: null, etoroOrderId: null } : args.order })) {
    await writeAudit({
      db: args.deps.db,
      eventType: "POSITION_CLOSE_SUBMITTED",
      requestId: args.order.referenceId,
      payload: { orderId: args.order.id, positionId: args.positionId },
    });
    sent = await client.closePosition({
      requestId: args.order.referenceId,
      positionId: args.positionId,
      instrumentID: args.instrumentId,
    });
  }
  let status: ExecutionConfirm["status"] = "AMBIGUOUS";
  let etoroOrderId: string | null =
    sent?.data?.orderForClose?.orderID !== undefined ? String(sent.data.orderForClose.orderID) : args.order.etoroOrderId;
  if (sent?.kind === "rejected" || sent?.kind === "rate_limited_giveup") {
    status = "REJECTED";
  } else {
    const reconciled = await reconcileCloseOrder({
      client,
      positionId: args.positionId,
      etoroOrderId,
      sleep: args.deps.sleep,
      pnlWaitMs: args.deps.pnlWaitMs ?? 0,
    });
    status = reconciled.status;
    etoroOrderId = reconciled.etoroOrderId ?? etoroOrderId;
  }
  await args.deps.db
    .update(brokerOrders)
    .set({ status, etoroOrderId, rawResponseJson: sent ?? args.order.rawResponseJson, updatedAt: new Date() })
    .where(eq(brokerOrders.id, args.order.id));
  await writeAudit({
    db: args.deps.db,
    eventType: status === "FILLED" ? "ORDER_FILLED" : status === "REJECTED" ? "ORDER_REJECTED" : "ORDER_AMBIGUOUS",
    requestId: args.order.referenceId,
    payload: { action: "close", orderId: args.order.id, status },
  });
  await args.deps.redis.set(REDIS_KEYS.forceAccountSync, new Date().toISOString());
  return {
    http: 200,
    body: {
      status,
      orderId: args.order.id,
      etoroOrderId,
      referenceId: args.order.referenceId,
      blockReasons: status === "FILLED" ? [] : [status.toLowerCase()],
    },
  };
}
