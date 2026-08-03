import { IconClose } from '../../shared/ui/icons'

export interface CalendarDayDetailsProps {
  selectedDate: Date
  eventTitles: string
  actions: string[]
  onClose: () => void
  onAction: (action: string) => void
}

/**
 * Bottom day-details strip (Phase deferred extract).
 */
export default function CalendarDayDetails({
  selectedDate,
  eventTitles,
  actions,
  onClose,
  onAction,
}: CalendarDayDetailsProps) {
  return (
    <div className="day-details" role="region" aria-label="Day details">
      <div className="day-details-header">
        <h3>{selectedDate.toDateString()}</h3>
        <button
          type="button"
          className="day-details-close"
          aria-label="Close day details"
          onClick={onClose}
        >
          <IconClose size={18} />
        </button>
      </div>
      <p className="day-details-events">
        <span className="day-details-events-label">Events</span>
        {eventTitles || 'None'}
      </p>
      <div className="day-details-actions">
        {actions.map((action) => {
          const isDelete =
            action === 'Delete Event' || action === 'Delete Event…'
          const isPrimary =
            action === 'Add Event' ||
            action === 'Edit Event' ||
            action === 'Edit Event…'
          return (
            <button
              type="button"
              key={action}
              className={
                isDelete
                  ? 'day-details-btn day-details-btn-danger'
                  : isPrimary
                    ? 'day-details-btn day-details-btn-primary'
                    : 'day-details-btn day-details-btn-secondary'
              }
              onClick={() => onAction(action)}
            >
              {action}
            </button>
          )
        })}
      </div>
    </div>
  )
}
