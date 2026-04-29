from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import players, optimizer, gameweek
 
app = FastAPI(title="FPL Analyzer API", version="1.0.0")
 
from apscheduler.schedulers.background import BackgroundScheduler
from data.fpl_fetcher import (
    sync_bootstrap, sync_xg, sync_fixtures,
    sync_recent_events, cleanup_blank_gameweeks,
)
 
def bootstrap_sync():
    sync_bootstrap()
 
def xg_sync():
    sync_xg()

def gameweek_sync():
    """Keep the most recent finished/in-progress gameweeks fresh in
    player_gameweek_history, and prune any orphan rows for true blanks."""
    sync_fixtures()
    sync_recent_events(num_recent=3)
    cleanup_blank_gameweeks()
 
scheduler = BackgroundScheduler()
scheduler.add_job(bootstrap_sync, "interval", hours=2)   # transfer counts, form, prices
scheduler.add_job(gameweek_sync,  "interval", hours=2)   # per-GW points/stats + blank cleanup
scheduler.add_job(xg_sync,        "interval", hours=24)  # xG data — daily is enough
scheduler.start()
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://fpl-optimizer-one.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
 
app.include_router(players.router, prefix="/api/players", tags=["players"])
app.include_router(optimizer.router, prefix="/api/optimizer", tags=["optimizer"])
app.include_router(gameweek.router, prefix="/api/gameweek", tags=["gameweek"])
 
@app.get("/")
def root():
    return {"status": "FPL Analyzer running"}
 
@app.post("/admin/sync")
def manual_sync():
    sync_bootstrap()
    sync_fixtures()
    touched = sync_recent_events(num_recent=3)
    cleaned = cleanup_blank_gameweeks()
    sync_xg()
    return {
        "status": "Sync complete",
        "gw_rows_touched": touched,
        "blank_rows_cleaned": cleaned,
    }

@app.post("/admin/sync-history")
def manual_sync_history():
    from data.fpl_fetcher import init_db, sync_player_histories
    init_db()
    sync_player_histories()
    cleaned = cleanup_blank_gameweeks()
    return {"status": "History sync complete", "blank_rows_cleaned": cleaned}

@app.post("/admin/sync-recent")
def manual_sync_recent(num_recent: int = 3):
    """Fast incremental sync — refreshes the last N finished/current
    gameweeks via the bulk live endpoint. Use this between full history syncs."""
    touched = sync_recent_events(num_recent=num_recent)
    cleaned = cleanup_blank_gameweeks()
    return {
        "status": "Recent sync complete",
        "gw_rows_touched": touched,
        "blank_rows_cleaned": cleaned,
    }

@app.post("/admin/cleanup-blanks")
def manual_cleanup_blanks():
    cleaned = cleanup_blank_gameweeks()
    return {"status": "Cleanup complete", "blank_rows_cleaned": cleaned}