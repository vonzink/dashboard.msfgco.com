function dateParts(value) {
  const text = String(value || '');
  const [date, rawTime = ''] = text.split('T');
  return {
    date: date || null,
    time: rawTime ? rawTime.slice(0, 8) : null,
  };
}

function normalizeGoogleEvent(event, connection) {
  const startValue = event.start?.dateTime || event.start?.date;
  const endValue = event.end?.dateTime || event.end?.date || startValue;
  const start = dateParts(startValue);
  const end = dateParts(endValue);
  const visibility = connection.privacy_default || 'availability_only';
  const shared = visibility === 'shared_details';

  return {
    user_id: connection.user_id,
    status: 'busy',
    start_date: start.date,
    end_date: end.date || start.date,
    start_time: event.start?.dateTime ? start.time : null,
    end_time: event.end?.dateTime ? end.time : null,
    timezone: 'America/Denver',
    note: shared ? (event.summary || null) : null,
    visibility,
    source: 'google',
    source_provider: 'google',
    source_event_id: event.id,
  };
}

module.exports = {
  normalizeGoogleEvent,
};
