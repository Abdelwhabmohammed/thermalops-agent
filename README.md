# ThermalOps Agent — Autonomous Heat-Safety Intelligence

[![Next.js](https://img.shields.io/badge/Next.js-16.3-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![FortyGuard API](https://img.shields.io/badge/FortyGuard-Temperature_API-orange)](https://fortyguard.com)
[![Gemini](https://img.shields.io/badge/Google_Gemini-3.7_Flash-8E75B2?style=flat&logo=google)](https://ai.google.dev/)
[![Railway](https://img.shields.io/badge/Deploy-Railway-0B0D0E?style=flat&logo=railway)](https://thermalops-agent-production.up.railway.app/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Autonomous AI agent that monitors hyperlocal heat conditions at outdoor worksites, fuses **FortyGuard Temperature API®** with **CDC Social Vulnerability Index** data and real-time atmospheric modeling, and autonomously decides whether to issue worker safety alerts, escalate stop-work directives, or declare safe conditions.

**Live Deployment:** [ThermalOps Agent — Autonomous Heat-Safety Decisions](https://thermalops-agent-production.up.railway.app/)

Built for the **FortyGuard Global AI Hackathon 2026** (Track 06: Agentic AI + Track 04: Government & Environment).

---

## Table of Contents

- [Project Overview](#project-overview)
- [Live Deployment](#live-deployment)
- [System Architecture](#system-architecture)
- [Key Features & Capabilities](#key-features--capabilities)
- [Agent Decision Engine](#agent-decision-engine)
- [FortyGuard API Integration](#fortyguard-api-integration)
- [Installation & Local Setup](#installation--local-setup)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [License](#license)

---

## Project Overview

ThermalOps Agent transforms environmental temperature telemetry into proactive, OSHA-compliant operational actions and quantified financial risk assessments for outdoor workforces.

Outdoor workforces face severe heat-related health hazards and substantial productivity loss. Traditional weather services only deliver regional-scale estimates, missing localized surface heat anomalies caused by asphalt radiant load, lack of canopy shade, elevated humidity, and socioeconomic vulnerability.

ThermalOps Agent operates as a single-stack, continuous intelligence platform that:
- Fuses FortyGuard satellite thermal observations, EPA air quality, solar irradiance, and CDC census-tract vulnerability.
- Executes an automated 3-tier reasoning loop (Deterministic Rules → Gemini 3.6 Flash → Gemini 3.7 Pro).
- Constructs 24-hour operational shift plans with concrete work/rest windows.
- Models dollar-quantified productivity value at risk using International Labour Organization (ILO) standards.
- Deploys a State Watch Sentinel Network across high-risk US regions.

---

## Live Deployment

The application is deployed and hosted on Railway:

**Production URL:** [https://thermalops-agent-production.up.railway.app/](https://thermalops-agent-production.up.railway.app/)

The deployment runs the complete stack in a single container: Next.js App Router, Leaflet GIS client, background cron schedulers, Prisma ORM, SQLite database, and the tiered Gemini decision pipeline.

---

## System Architecture

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                   NEXT.JS 16 (Unified Container Architecture)           │
 │                                                                         │
 │  ┌──────────────────────────── UI Layer (React 19) ──────────────────┐  │
 │  │  Portfolio KPI Band · Leaflet Dark Risk Map · State Watch Network │  │
 │  │  Map Location Probe · Live Alert Feed · 24h Shift Planner + ROI   │  │
 │  │  Spatial Analyses (Satellite & PDF) · Decision Audit Trail        │  │
 │  └───────────────────────────────┬───────────────────────────────────┘  │
 │                                  │ fetch /api/*                         │
 │  ┌───────────────────────────────▼───────────────────────────────────┐  │
 │  │                  API Route Layer (App Router)                     │  │
 │  │  /api/sites  /status  /poll  /forecast  /analysis  /report        │  │
 │  │  /api/probe  /api/states  /api/states/sweep  /api/summary /alerts │  │
 │  └───────────────────────────────┬───────────────────────────────────┘  │
 │  ┌───────────────────────────────▼───────────────────────────────────┐  │
 │  │              Agent Core (Tiered AI Decision Engine)               │  │
 │  │   Rule Engine (Deterministic) → Gemini Flash → Gemini Pro         │  │
 │  │   OSHA/NIOSH Wet-Bulb Tiers + Composite Risk (WB/AQI/SVI/GHI)     │  │
 │  │   Diurnal Curve Extraction → Shift Plan Engine → ILO Cost Model   │  │
 │  └──────────┬──────────────────────────────────┬─────────────────────┘  │
 │  ┌──────────▼─────────────┐      ┌─────────────▼─────────────────────┐  │
 │  │ Background Scheduler   │      │ Data & Modeling Layer             │  │
 │  │ (instrumentation.ts)   │      │ FortyGuard API (Async Tasks)      │  │
 │  │ Env Params: 5 min      │      │ NOAA / NWS / Open-Meteo Weather   │  │
 │  │ Heatmap: 60 min        │      │ CDC SVI 2022 Dataset · SQLite DB  │  │
 │  └────────────────────────┘      └───────────────────────────────────┘  │
 └─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features & Capabilities

### 1. Autonomous Agent Loop
- Continuous 5-minute polling cycles per active worksite.
- Fuses surface temperature, wet-bulb, air quality, solar irradiance, and census tract vulnerability scores.
- Automatically creates audit-ready incident logs and delivers deduplicated alerts to operations supervisors.

### 2. State Watch Sentinel Network
- Regional monitoring coverage across high-heat states (`AZ`, `TX`, `IL`, `NV`, `FL`, `CA`).
- Multi-location sentinel sweeps combining real-time National Weather Service observations with CDC census tract vulnerability data.
- One-click promotion of elevated sentinel points into fully monitored worksites.

### 3. Interactive Map & Instant Location Probing
- High-contrast dark-mode geospatial interface powered by Leaflet and Esri basemaps.
- Click-to-probe tool delivers instant microclimate evaluations for any geographic coordinate in the continental United States.
- Direct integration with FortyGuard satellite land-cover layers.

### 4. 24-Hour Shift Planner
- Converts diurnal environmental curves into actionable operational shift recommendations.
- Outlines optimal heavy-work time windows (e.g., 4:00 AM – 9:00 AM) and mandatory cooling rotations during peak heat hours.

### 5. Cost-of-Inaction Economic Model
- Quantifies immediate daily productivity value at risk based on the ILO 2% per °C thermal degradation standard above 25°C Wet-Bulb.
- Projects seasonal financial exposure and incident mitigation estimates backed by National Safety Council actuarial claim benchmarks.

### 6. Deep Spatial Intelligence & PDF Reporting
- Satellite land-cover segmentation classifies tree canopy, asphalt, and building footprints to evaluate radiant heat and shade deficits.
- Generates and caches multi-dimensional FortyGuard Heat Intelligence PDF reports.

---

## Agent Decision Engine

The agent uses a cost-efficient, three-tier architecture:

```
                  ┌───────────────────────────────┐
                  │    Incoming Telemetry Data    │
                  │ (Wet-Bulb, Temp, AQI, SVI, GHI)│
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │      Risk Scorer Engine       │
                  │   Composite Index: 0 to 100   │
                  └───────────────┬───────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │ (<25°C WB or >32°C WB)  │ (Routine Advisory)      │ (Borderline / High-SVI)
        ▼                         ▼                         ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│  Tier 1: Rule │         │ Tier 2: Flash │         │  Tier 3: Pro  │
│ Deterministic │         │ Gemini 3.6    │         │  Gemini 3.7   │
│ Zero Latency  │         │ Standard Plan │         │ Deep Reasoning│
└───────┬───────┘         └───────┬───────┘         └───────┬───────┘
        │                         │                         │
        └─────────────────────────┼─────────────────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │   OSHA Compliance Decision    │
                  │  Action Plan + Alert Stream   │
                  └───────────────────────────────┘
```

1. **Tier 1 (Deterministic Rules):** Clear-cut safe conditions (Wet-Bulb < 25°C) or severe extremes are processed instantly with zero API overhead.
2. **Tier 2 (Gemini 3.6 Flash):** Standard advisory scenarios utilize fast structured output generation for operational guidance.
3. **Tier 3 (Gemini 3.7 Pro):** Complex composite conditions (28°C–32°C Wet-Bulb band paired with elevated AQI or high CDC vulnerability) trigger multi-variable reasoning with the authority to override baseline classifications.

---

## FortyGuard API Integration

The platform integrates five core FortyGuard API endpoints:

| Endpoint | Function | Plan Level |
|---|---|---|
| `POST /v1/env_params` | Real-time wet-bulb, air quality, humidity, solar GHI, and 24h forecast series | Standard / Premium |
| `POST /v1/heatmap` | High-resolution satellite land surface temperature extraction | Standard / Premium |
| `POST /v1/satellite` | Spatial land-cover segmentation (tree canopy vs. impervious surfaces) | Premium |
| `POST /v1/heat_intelligence` | Multi-dimensional urban, environmental, and anthropogenic heat PDF reporting | Standard / Premium |
| `GET /v1/status/{id}` | Asynchronous task polling and status tracking | Standard / Premium |

---

## Installation & Local Setup

### Prerequisites
- Node.js 20 LTS or higher
- npm 10+
- FortyGuard API Key
- Google Gemini API Key

### Setup Instructions

```bash
# 1. Clone the repository
git clone https://github.com/your-org/thermalops-agent.git
cd thermalops-agent

# 2. Configure environment variables
cp .env.example .env
# Open .env and add FORTYGUARD_API_KEY and GEMINI_API_KEY

# 3. Install dependencies
npm install

# 4. Generate Prisma client and initialize SQLite database
npm run db:push

# 5. Download the CDC SVI dataset (one-time setup)
npm run download-svi

# 6. Seed initial worksites
npm run seed

# 7. Start the local server
npm run dev
```

Navigate to `http://localhost:3000` in the browser.

---

## API Reference

### Core Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status and database connectivity |
| `GET` | `/api/summary` | Portfolio-level KPI aggregations and agent metrics |
| `GET` | `/api/sites` | List all registered sites with active status and SVI rankings |
| `POST` | `/api/sites` | Register a new worksite with automated CDC SVI census tract matching |
| `GET` | `/api/sites/:id/status` | Current environmental telemetry and decision history |
| `POST` | `/api/sites/:id/poll` | Trigger an immediate on-demand agent decision cycle |
| `GET` | `/api/sites/:id/forecast` | 24-hour diurnal heat curve, shift plan, and cost-of-inaction model |
| `POST` | `/api/sites/:id/analysis` | Initiate satellite land-cover or Heat Intelligence analysis |
| `GET` | `/api/sites/:id/analysis` | Retrieve completed spatial analysis data |
| `GET` | `/api/sites/:id/report` | Stream cached Heat Intelligence PDF report |
| `POST` | `/api/probe` | Instant microclimate diagnostic for any latitude/longitude |
| `GET` | `/api/states` | Retrieve State Watch regional sentinel network catalog |
| `POST` | `/api/states/sweep` | Execute multi-location sentinel sweep for an entire state |
| `GET` | `/api/alerts/feed` | Real-time worker safety alert feed |
| `POST` | `/api/alerts/:id/acknowledge` | Acknowledge active safety alert |
| `DELETE` | `/api/sites/:id` | Deactivate a worksite |

---

## Project Structure

```
├── Dockerfile                     # Multi-stage production container configuration
├── .dockerignore                  # Container build exclusion list
├── prisma/schema.prisma           # Relational SQLite database schema
├── src/
│   ├── instrumentation.ts         # Server startup hook initializing background scheduler
│   ├── app/
│   │   ├── layout.tsx             # Root layout with dark ops theme
│   │   ├── page.tsx               # Primary dashboard interface
│   │   ├── globals.css            # Global CSS tokens and base styles
│   │   └── api/                   # Route handlers for sites, probe, states, and alerts
│   ├── components/thermalops/     # Specialized Dashboard Components:
│   │   ├── SiteMap.tsx            # Leaflet map, site markers, and probe controls
│   │   ├── StateWatch.tsx         # Regional sentinel network sweep interface
│   │   ├── AlertFeed.tsx          # Real-time safety alert feed with acknowledgment
│   │   ├── SiteDetailPanel.tsx    # Telemetry data, readings grid, and audit trail
│   │   ├── ShiftPlan.tsx          # 24-hour shift schedule and cost-of-inaction cards
│   │   ├── SiteAnalysis.tsx       # Satellite segmentation and PDF report viewer
│   │   └── TrendSparkline.tsx     # 48-hour thermal trend visualization
│   └── lib/
│       ├── server/                # Server Core Modules:
│       │   ├── agent.ts           # Tiered agent decision logic and cycle runner
│       │   ├── state-watch.ts     # State sentinel network definitions and sweep engine
│       │   ├── weather.ts         # Atmospheric data fetching and Stull wet-bulb formula
│       │   ├── forecast.ts        # Shift planning algorithm and ILO productivity model
│       │   ├── risk-scorer.ts     # OSHA/NIOSH threshold scoring
│       │   ├── prompts.ts         # Gemini agent system prompts
│       │   ├── schemas.ts         # Zod schemas for structured agent outputs
│       │   ├── fortyguard.ts      # FortyGuard API client
│       │   ├── gemini.ts          # Google Gemini integration (@google/genai)
│       │   ├── svi.ts             # Census Geocoder and CDC SVI data matching
│       │   ├── heatmap.ts         # Satellite land surface temperature refresh
│       │   └── scheduler.ts       # Node-cron background task manager
│       └── api.ts, types.ts, utils.ts # Client API wrappers, TypeScript interfaces, utilities
├── scripts/
│   ├── download-svi.mjs           # Automated CDC SVI dataset retriever
│   └── seed-sites.mjs             # Seed database with demo industrial sites
└── docs/                          # Architecture diagrams, deployment guides, demo script
```

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

*Developed for the FortyGuard Global AI Hackathon 2026.*
