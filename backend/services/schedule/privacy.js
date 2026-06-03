const { getUserId } = require('../../middleware/userContext');

const STATUS_LABELS = {
  out: 'Out',
  remote: 'Remote',
  traveling: 'Traveling',
  meeting_event: 'Meeting/Event',
  other: 'Unavailable',
  busy: 'Busy',
};

function entryViewers(entry) {
  return (Array.isArray(entry?.viewers) ? entry.viewers : [])
    .filter((viewer) => viewer && viewer.user_id != null)
    .map((viewer) => ({
      user_id: viewer.user_id,
      name: viewer.name || null,
      email: viewer.email || null,
    }));
}

function isEntryOwner(entry, req) {
  return Number(entry?.user_id) === Number(getUserId(req));
}

function canViewScheduleEntry(entry, req) {
  if (isEntryOwner(entry, req)) return true;
  if (entry.visibility !== 'shared_details') return false;

  const viewers = entryViewers(entry);
  if (!viewers.length) return true;

  const viewerId = Number(getUserId(req));
  return viewers.some((viewer) => Number(viewer.user_id) === viewerId);
}

function canSeeDetails(entry, req) {
  if (!canViewScheduleEntry(entry, req)) return false;
  if (entry.visibility === 'shared_details') return true;
  return isEntryOwner(entry, req);
}

function presentScheduleEntry(entry, req) {
  const visible = canSeeDetails(entry, req);
  const visibleAttendees = visible && Array.isArray(entry.attendees) ? entry.attendees : [];
  const owner = isEntryOwner(entry, req);

  return {
    id: entry.id,
    user_id: entry.user_id,
    employee_name: entry.employee_name || null,
    employee_initials: entry.employee_initials || null,
    employee_role: entry.employee_role || null,
    employee_nmls_number: entry.employee_nmls_number || null,
    status: visible ? entry.status : 'busy',
    display_label: visible ? (STATUS_LABELS[entry.status] || 'Unavailable') : 'Busy',
    start_date: entry.start_date,
    end_date: entry.end_date,
    start_time: entry.start_time,
    end_time: entry.end_time,
    timezone: entry.timezone || 'America/Denver',
    note: visible ? (entry.note || null) : null,
    visibility: entry.visibility,
    source: entry.source,
    source_provider: entry.source_provider || null,
    provider_owned: Boolean(entry.source_provider && entry.source_event_id),
    details_shareable: Boolean(entry.details_shareable),
    provider_sensitivity: entry.provider_sensitivity || null,
    event_color: entry.event_color || null,
    sync_write_status: entry.sync_write_status || 'idle',
    sync_write_error: visible && entry.sync_write_status === 'error' ? (entry.sync_write_error || null) : null,
    sync_write_attempted_at: visible ? (entry.sync_write_attempted_at || null) : null,
    attendees: visibleAttendees,
    viewers: owner ? entryViewers(entry) : [],
    private: !visible,
    created_by: entry.created_by || null,
    updated_by: entry.updated_by || null,
  };
}

module.exports = {
  canViewScheduleEntry,
  canSeeDetails,
  presentScheduleEntry,
};
