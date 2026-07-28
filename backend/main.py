from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import players, optimizer, gameweek

app = FastAPI(title="FPL Analyzer API", version="2.0.0")

# NOTE ON SYNCING
# ---------------
# Data syncing is handled by an EXTERNAL scheduler (GitHub Actions — see
# .github/workflows/sync.yml), not an in-process scheduler. The old
# APScheduler BackgroundScheduler was removed because this API runs on a host
# that spins down when idle: a sleeping process can't run background jobs, so
# those syncs silently never fired. The GitHub Action runs the same sync
# functions on a cron against Supabase directly, which also keeps the free-tier
# database from auto-pausing. The /admin endpoints below remain as manual
# fallbacks / on-demand triggers.

# CORS: every browser request comes from the Vercel frontend, so an origin that
# isn't listed here gets its response blocked by the browser and the UI silently
# renders empty ("0 players shown") even though the API is healthy. The regex
# covers Vercel preview deployments and renamed projects, so pointing the app at
# a new *.vercel.app domain doesn't take the site down again.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "https://fpl-optimizer-one.vercel.app",
        "https://thexgfiles.vercel.app",
    ],
    allow_origin_regex=r"https://(thexgfiles|fpl-optimizer|fpl-lab)[a-z0-9.-]*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(players.router, prefix="/api/players", tags=["players"])
app.include_router(optimizer.router, prefix="/api/optimizer", tags=["optimizer"])
app.include_router(gameweek.router, prefix="/api/gameweek", tags=["gameweek"])


# HEAD is allowed alongside GET because uptime monitors (which keep this
# instance from sleeping) send HEAD by default — it returns headers only. FastAPI
# does not add HEAD automatically, so a GET-only route answers 405 and the
# monitor reports the service as down even though it is healthy.
@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"status": "FPL Analyzer running"}


@app.post("/admin/sync")
def manual_sync():
    """Light sync: prices/form/xG + fixtures + latest GW live stats + projections."""
    from data.fpl_fetcher import sync_light
    sync_light()
    return {"status": "Light sync complete"}


@app.post("/admin/sync-deep")
def manual_sync_deep():
    """Deep sync: full per-player history, last-season + newcomer seeding, projections."""
    from data.fpl_fetcher import sync_deep
    sync_deep()
    return {"status": "Deep sync complete"}


@app.post("/admin/sync-history")
def manual_sync_history():
    from data.fpl_fetcher import (
        init_db, sync_player_histories, sync_understat_newcomers,
        sync_projections, cleanup_blank_gameweeks,
    )
    init_db()
    sync_player_histories(seed=True)
    sync_understat_newcomers()
    cleaned = cleanup_blank_gameweeks()
    sync_projections()
    return {"status": "History + seed sync complete", "blank_rows_cleaned": cleaned}


@app.post("/admin/sync-recent")
def manual_sync_recent(num_recent: int = 3):
    """Fast incremental sync — refreshes the last N gameweeks via the bulk live
    endpoint, then recomputes projections."""
    from data.fpl_fetcher import sync_recent_events, cleanup_blank_gameweeks, sync_projections
    touched = sync_recent_events(num_recent=num_recent)
    cleaned = cleanup_blank_gameweeks()
    sync_projections()
    return {
        "status": "Recent sync complete",
        "gw_rows_touched": touched,
        "blank_rows_cleaned": cleaned,
    }


@app.post("/admin/cleanup-blanks")
def manual_cleanup_blanks():
    from data.fpl_fetcher import cleanup_blank_gameweeks
    cleaned = cleanup_blank_gameweeks()
    return {"status": "Cleanup complete", "blank_rows_cleaned": cleaned}
