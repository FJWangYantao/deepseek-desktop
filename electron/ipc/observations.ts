import { ipcMain } from 'electron'
import { appendObservation, appendObservations, flushObservations } from '../observations/recorder'

export function registerObservationHandlers() {
  ipcMain.handle('observations:append', (_event, event: Record<string, unknown>) => {
    return appendObservation(event)
  })

  ipcMain.handle('observations:appendBatch', (_event, events: Record<string, unknown>[]) => {
    if (!Array.isArray(events)) return { ok: false, error: 'events must be array' }
    return appendObservations(events)
  })

  ipcMain.handle('observations:flush', () => {
    return flushObservations()
  })
}
