# ADR-004: No autonomous live execution in MVP

## Status

Accepted

## Decision

The application is read-only for live-money orders until a later milestone with explicit safety controls. The eToro client must not expose money-moving methods in Milestones 0–7.

## Consequences

Users execute on eToro manually. Sentinel journals and gates; it does not place live orders.
