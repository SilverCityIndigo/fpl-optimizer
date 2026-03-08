from fastapi import APIRouter
from pydantic import BaseModel
from services.optimizer import optimize_squad, suggest_transfers, suggest_captain, analyze_chips, analyze_hit_worthiness

router = APIRouter()

class TransferRequest(BaseModel):
    current_squad_ids: list[int]
    budget_itb: float
    free_transfers: int = 1

class CaptainRequest(BaseModel):
    current_squad_ids: list[int]

class HitAnalysisRequest(BaseModel):
    current_squad_ids: list[int]
    budget_itb: float
    free_transfers: int = 1

class ChipRequest(BaseModel):
    current_squad_ids: list[int]

@router.get("/squad")
def get_optimal_squad(budget: float = 100.0):
    return optimize_squad(budget=budget)

@router.post("/transfers")
def get_transfer_suggestions(req: TransferRequest):
    return suggest_transfers(
        current_squad_ids=req.current_squad_ids,
        budget_itb=req.budget_itb,
        free_transfers=req.free_transfers
    )

@router.post("/captain")
def get_captain_pick(req: CaptainRequest):
    return suggest_captain(current_squad_ids=req.current_squad_ids)

@router.post("/hit-analysis")
def get_hit_analysis(req: HitAnalysisRequest):
    return analyze_hit_worthiness(
        current_squad_ids=req.current_squad_ids,
        budget_itb=req.budget_itb,
        free_transfers=req.free_transfers
    )

@router.post("/chips")
def get_chip_advice(req: ChipRequest):
    return analyze_chips(current_squad_ids=req.current_squad_ids)