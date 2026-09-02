# ADR-004: No autonomous live execution in MVP

## Status

Accepted

## Decision

The application is read-only for live-money orders. Milestone 9 may place **Demo** orders only, behind the isolation rules in ADR-016. The eToro client must not expose Real execution methods.

## Consequences

Users may confirm Demo orders after Trade Gate approval. Live-money and Real execution paths stay out of the repository.
