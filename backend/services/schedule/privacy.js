const { getUserId, hasRole } = require('../../middleware/userContext');

const STATUS_LABELS = {
  out: 'Out',
  remote: 'Remote',
  traveling: 'Traveling',
  meeting_event: 'Meeting/Event',
  other: 'Unavailable',
  busy: 'Busy',
};

function canSeeDetails(entry, req) {
  if (entry.visibility === 'shared_details') return true;
  if (Number(entry.user_id) === Number(getUserId(req))) return true;
  return hasRole(req, 'admin', 'manager') && entry.source === 'manual';
}

function presentScheduleEntry(entry, req) {
  const visible = canSeeDetails(entry, req);
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
    sync_write_error: entry.sync_write_status === 'error' ? (entry.sync_write_error || null) : null,
    sync_write_attempted_at: entry.sync_write_attempted_at || null,
    attendees: Array.isArray(entry.attendees) ? entry.attendees : [],
    private: !visible,
    created_by: entry.created_by || null,
    updated_by: entry.updated_by || null,
  };
}

module.exports = {
  canSeeDetails,
  presentScheduleEntry,
};
