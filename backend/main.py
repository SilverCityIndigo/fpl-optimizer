from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import players, optimizer, gameweek
 
app = FastAPI(title="FPL Analyzer API", version="1.0.0")
 
from apscheduler.schedulers.background import BackgroundScheduler
from data.fpl_fetcher import sync_bootstrap, sync_xg, sync_fixtures
 
def bootstrap_sync():
    sync_bootstrap()
 
def xg_sync():
    sync_xg()
 
scheduler = BackgroundScheduler()
scheduler.add_job(bootstrap_sync, "interval", hours=2)   # transfer counts, form, prices
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
    sync_xg()
    return {"status": "Sync complete"}

@app.post("/admin/sync-history")
def manual_sync_history():
    from data.fpl_fetcher import init_db, sync_player_histories
    init_db()
    sync_player_histories()
    return {"status": "History sync complete"}