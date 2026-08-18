import axios from 'axios'

const api = axios.create({
  baseURL: 'https://fpl-lab-backend.onrender.com'
})

export const getPlayers = (position = null) => {
  const params = position ? { position } : {}
  return api.get('/api/players/', { params })
}

export const getValuePicks = () => api.get('/api/players/value')
export const getDifferentials = () => api.get('/api/players/differentials')
export const getCurrentGameweek = () => api.get('/api/gameweek/current')
export const getFdrTable = (nextGws = 5) => api.get('/api/gameweek/fdr-table', { params: { next_gws: nextGws } })

export const getTeamSquad = (teamId) => api.get(`/api/players/team/${teamId}`)
export const getPlayerHistory = (playerId) => api.get(`/api/players/${playerId}/history`)

export const getTransferSuggestions = (squadIds, budgetItb, freeTransfers) =>
  api.post('/api/optimizer/transfers', {
    current_squad_ids: squadIds,
    budget_itb: budgetItb,
    free_transfers: freeTransfers
  })

export const getHitAnalysis = (squadIds, budgetItb, freeTransfers) =>
  api.post('/api/optimizer/hit-analysis', {
    current_squad_ids: squadIds,
    budget_itb: budgetItb,
    free_transfers: freeTransfers
  })

export const getCaptainPick = (squadIds) =>
  api.post('/api/optimizer/captain', {
    current_squad_ids: squadIds
  })

export const getPriceChanges = () => api.get('/api/players/price-changes')

// Pre-season squad sources. The team-ID import cannot work before the GW1
// deadline (FPL does not publish picks until it locks), so these two stand in.
export const getDraftSquad = (budget = 100) =>
  api.get('/api/optimizer/draft-squad', { params: { budget } })

export const getSquadFromIds = (playerIds, budget = 100) =>
  api.post('/api/optimizer/squad-from-ids', { player_ids: playerIds, budget })

export const getChipAdvice = (squadIds) =>
  api.post('/api/optimizer/chips', { current_squad_ids: squadIds })

export default api
