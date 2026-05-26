function dateParts(value) {
  const text = String(value || '');
  const [date, rawTime = ''] = text.split('T');
  return {
    date: date || null,
    time: rawTime ? rawTime.slice(0, 8) : null,
  };
}

function normalizeOutlookEvent(event, connection) {
  const start = dateParts(event.start?.dateTime);
  const end = dateParts(event.end?.dateTime);
  const visibility = connection.privacy_default || 'availability_only';
  const shared = visibility === 'shared_details';

  return {
    user_id: connection.user_id,
    status: 'busy',
    start_date: start.date,
    end_date: end.date || start.date,
    start_time: start.time,
    end_time: end.time,
    timezone: 'America/Denver',
    note: shared ? (event.subject || null) : null,
    visibility,
    source: 'outlook',
    source_provider: 'outlook',
    source_event_id: event.id,
  };
}

module.exports = {
  normalizeOutlookEvent,
};
