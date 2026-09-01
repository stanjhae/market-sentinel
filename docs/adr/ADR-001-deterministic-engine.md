# ADR-001: Deterministic strategy engine vs LLM signal generation

## Status

Accepted

## Decision

All signals, indicators, scores, risk calculations, and order plans are generated deterministically from code and market/account data. An LLM may only summarize structured evidence.

## Consequences

The AI layer is optional and cannot be the source of truth for prices, levels, sizing, or signal state.
