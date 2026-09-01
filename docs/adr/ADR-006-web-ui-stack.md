# ADR-006: Web UI stack

## Status

Accepted

## Decision

The dashboard is a desktop-first Next.js App Router app using Tailwind CSS and shadcn/ui. Personal React Native / NativeWind / HStack conventions from other products do not apply to this repository.

## Consequences

Charting and dense finance-terminal layouts can use standard web primitives (`div`, shadcn components, Lightweight Charts in a later milestone).
