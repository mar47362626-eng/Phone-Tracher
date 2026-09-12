const refreshButton = document.querySelector('#refreshButton');
const lastUpdate = document.querySelector('#lastUpdate');
const mapTime = document.querySelector('#mapTime');
const activityTime = document.querySelector('#activityTime');
const activeCount = document.querySelector('#activeCount');
const personPhoto = document.querySelector('#personPhoto');
const personName = document.querySelector('#personName');
const personEmail = document.querySelector('#personName').nextElementSibling;
const personLocation = document.querySelector('#personLocation');
const journeySummary = document.querySelector('#journeySummary');
const demoNotice = document.querySelector('.demo-notice');
const personCard = document.querySelector('.person-card');
const consentDetail = document.querySelector('.consent-detail');
const peopleCount = document.querySelector('.people-count');
const distanceTraveled = document.querySelector('#distanceTraveled');
const peopleLocations = document.querySelector('#peopleLocations');
const locationMap = document.querySelector('#locationMap');
const map = window.L ? L.map(locationMap, { zoomControl: true }).setView([20, 0], 2) : null;
const markerLayer = map ? L.layerGroup().addTo(map) : null;
if (map) {
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '&copy; Esri, Maxar, Earthstar Geographics' });
  streetLayer.addTo(map);
  L.control.layers({ Streets: streetLayer, 'Aerial photo': satelliteLayer }, null, { collapsed: false }).addTo(map);
}
const safetyActivity = document.querySelector('#safetyActivity');
const safetyCount = document.querySelector('#safetyCount');
const geofenceStatus = document.querySelector('#geofenceStatus');
const geofenceRadius = document.querySelector('#geofenceRadius');
const setGeofence = document.querySelector('#setGeofence');
const authGate = document.querySelector('#authGate');
const authForm = document.querySelector('#authForm');
const authIntro = document.querySelector('#authIntro');
const authEmail = document.querySelector('#authEmail');
const authPassword = document.querySelector('#authPassword');
const authPin = document.querySelector('#authPin');
const authPinLabel = document.querySelector('#authPinLabel');
const authError = document.querySelector('#authError');
const authSubmit = document.querySelector('#authSubmit');
const authMode = document.querySelector('#authMode');
const enableEmergencySound = document.querySelector('#enableEmergencySound');
const emergencyBanner = document.querySelector('#emergencyBanner');
const locationLookup = document.querySelector('#locationLookup');
const lookupEmail = document.querySelector('#lookupEmail');
const lookupPhone = document.querySelector('#lookupPhone');
const lookupClear = document.querySelector('#lookupClear');
const lookupMessage = document.querySelector('#lookupMessage');
let activePersonId = null;
geofenceRadius.setAttribute('aria-label', 'Safety zone radius');
let placeRequestId = 0;
let loginWithPin = false;
let lookupQuery = '';

async function initializeAuth() {
  const response = await fetch('/api/auth/status', { cache: 'no-store' });
  const status = await response.json();
  if (status.authenticated) return true;
  authGate.hidden = false;
  document.querySelector('.admin-shell').hidden = true;
  if (status.configured) {
    authIntro.textContent = 'Sign in to view consented locations and safety alerts.';
    authSubmit.textContent = 'Sign in';
    authMode.hidden = false;
    authEmail.required = false;
  } else {
    authPinLabel.hidden = false;
    authPin.required = true;
  }
  return false;
}

authMode.addEventListener('click', () => {
  loginWithPin = !loginWithPin;
  authPinLabel.hidden = !loginWithPin;
  authPassword.hidden = loginWithPin;
  authPassword.required = !loginWithPin;
  authSubmit.textContent = loginWithPin ? 'Sign in with PIN' : 'Sign in';
  authMode.textContent = loginWithPin ? 'Use password instead' : 'Use PIN instead';
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authError.textContent = '';
  const setup = authSubmit.textContent === 'Set up owner account';
  const payload = setup ? { email: authEmail.value, password: authPassword.value, pin: authPin.value } : loginWithPin ? { pin: authPin.value } : { password: authPassword.value };
  const response = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) {
    authError.textContent = (await response.json().catch(() => ({}))).error || 'Authentication failed.';
    return;
  }
  window.location.reload();
});
let soundContext = null;
let knownSosIds = new Set();
let safetyStateInitialized = false;
const emergencySoundKey = 'heretogether-emergency-sound-enabled';

function enableSound() {
  soundContext ||= new AudioContext();
  if (soundContext.state === 'suspended') soundContext.resume();
  localStorage.setItem(emergencySoundKey, 'true');
  enableEmergencySound.textContent = 'Emergency sound enabled';
  enableEmergencySound.classList.add('enabled');
}

function playEmergencySound() {
  if (!soundContext) return;
  if (soundContext.state === 'suspended') {
    soundContext.resume().then(playEmergencySound).catch(() => {});
    return;
  }
  if (soundContext.state !== 'running') return;
  const now = soundContext.currentTime;
  [0, 0.24, 0.48].forEach((offset) => {
    const oscillator = soundContext.createOscillator();
    const gain = soundContext.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
    oscillator.connect(gain).connect(soundContext.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.2);
  });
}

function formatPlace(location) {
  if (!location) return 'Location not detected yet';
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 1000) return `${Math.round(meters || 0)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function renderPeopleMap(people) {
  if (!map) {
    const locatedPeople = people.filter((person) => person.location);
    locationMap.innerHTML = locatedPeople.length ? locatedPeople.map((person) => `<div class="fallback-person-marker"><strong>${escapeHtml(person.name)}</strong><small>${person.location.latitude.toFixed(5)}, ${person.location.longitude.toFixed(5)}</small></div>`).join('') : '<p class="fallback-map-message">No shared locations yet.</p>';
    return;
  }
  markerLayer.clearLayers();
  const locatedPeople = people.filter((person) => person.location);
  const bounds = [];
  locatedPeople.forEach((person) => {
    const { latitude, longitude } = person.location;
    const history = (person.locationHistory || []).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
    if (history.length > 1) markerLayer.addLayer(L.polyline(history.map((point) => [point.latitude, point.longitude]), { color: '#4e8065', weight: 4, opacity: 0.8 }));
    const accuracy = Number(person.location.accuracy) || 0;
    const accuracyText = accuracy ? `Approximate area: within ${formatDistance(accuracy)}` : 'Accuracy unavailable';
    const marker = L.marker([latitude, longitude]).bindPopup(`<strong>${escapeHtml(person.name)}</strong><br><small>Sharing live<br>${escapeHtml(accuracyText)}</small>`).bindTooltip(escapeHtml(person.name), { permanent: true, direction: 'top', offset: [0, -18] });
    markerLayer.addLayer(marker);
    if (accuracy > 0) markerLayer.addLayer(L.circle([latitude, longitude], { radius: accuracy, color: '#5c9b76', fillColor: '#b9ddc5', fillOpacity: 0.18, weight: 1 }));
    history.forEach((point) => bounds.push([point.latitude, point.longitude]));
    if (!history.length) bounds.push([latitude, longitude]);
  });
  if (bounds.length === 1) map.setView(bounds[0], 15);
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15 });
  if (!bounds.length) map.setView([20, 0], 2);
  window.setTimeout(() => map.invalidateSize(), 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function describeJourney(person) {
  const history = (person.locationHistory || []).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!history.length) return 'No movement history recorded yet.';
  const first = history[0];
  const last = history[history.length - 1];
  const firstTime = first.updatedAt ? new Date(first.updatedAt).toLocaleString() : 'the first update';
  const lastTime = last.updatedAt ? new Date(last.updatedAt).toLocaleString() : 'the latest update';
  return history.length > 1 ? `Started near ${formatPlace(first)} at ${firstTime}, then reached ${formatPlace(last)} at ${lastTime}. ${history.length} location updates recorded over ${formatDistance(person.totalDistanceMeters || 0)}.` : `First location recorded at ${formatPlace(first)} on ${firstTime}.`;
}

function renderPeopleLocations(people) {
  peopleLocations.innerHTML = people.length ? people.map((person) => {
    const location = person.location;
    const place = location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'Waiting for location permission';
    const updated = person.updatedAt ? new Date(person.updatedAt).toLocaleString() : 'Not updated yet';
    const mapLink = location ? `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}` : '#';
    return `<div class="person-location-row"><span class="person-location-avatar">${escapeHtml(person.name.slice(0, 2).toUpperCase())}</span><span class="person-location-info"><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(place)}</small><small>Updated ${escapeHtml(updated)}</small></span><a href="${mapLink}" target="_blank" rel="noreferrer" class="view-location-link"${location ? '' : ' aria-disabled="true"'}>View place</a></div>`;
  }).join('') : '<p class="no-people-location">No active people are sharing a location.</p>';
}

function applySafetyActivity(people) {
  const firstPerson = people[0];
  activePersonId = firstPerson?.id || null;
  geofenceStatus.textContent = firstPerson?.geofence ? `Safety zone: ${firstPerson.geofence.radius} m` : 'No safety zone set';
  const events = people.flatMap((person) => [
    ...(person.alerts || []).map((item) => ({ ...item, personName: person.name, className: item.type === 'SOS' ? 'urgent' : 'checkin', label: item.type === 'SOS' ? `${person.name} sent an SOS: ${item.message}` : `${person.name} triggered a ${item.type.toLowerCase()} alert` })),
    ...(person.checkIns || []).map((item) => ({ ...item, personName: person.name, className: 'checkin', label: `${person.name} checked in` })),
    ...(person.evidence || []).map((item) => ({ ...item, personName: person.name, className: 'evidence', label: `${person.name} shared evidence: ${item.name}` }))
  ]).sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  const alerts = events.filter((item) => item.type === 'SOS');
  const newSos = safetyStateInitialized ? alerts.filter((alert) => !knownSosIds.has(alert.id)) : [];
  if (newSos.length) {
    emergencyBanner.textContent = `EMERGENCY: ${newSos[0].personName} sent an SOS alert.`;
    emergencyBanner.hidden = false;
    playEmergencySound();
    window.setTimeout(() => { emergencyBanner.hidden = true; }, 10000);
  }
  alerts.forEach((alert) => knownSosIds.add(alert.id));
  safetyStateInitialized = true;
  const recentEvents = events.slice(0, 8);
  safetyCount.textContent = alerts.length ? `${alerts.length} SOS alert${alerts.length === 1 ? '' : 's'}` : 'No alerts';
  safetyActivity.innerHTML = recentEvents.length ? recentEvents.map((event) => `<div class="safety-event ${escapeHtml(event.className)}"><span></span><strong>${escapeHtml(event.label)}</strong><time>${escapeHtml(new Date(event.createdAt).toLocaleString())}</time></div>`).join('') : '<p>No safety activity yet.</p>';
}

function applyPeople(people) {
  activeCount.textContent = people.length;
  renderPeopleLocations(people);
  demoNotice.lastElementChild.innerHTML = `<strong>Connected dashboard</strong>${people.length ? ' Live locations are being read from the server for consented connections.' : ' No one is actively sharing right now.'}`;
  peopleCount.textContent = `${people.length} ${people.length === 1 ? 'person' : 'people'}`;
  const person = people[0];
  if (!person) {
    renderPeopleMap([]);
    personCard.hidden = true;
    consentDetail.hidden = true;
    lastUpdate.textContent = 'No active sharing';
    distanceTraveled.textContent = '0 m';
    safetyCount.textContent = 'No alerts';
    safetyActivity.innerHTML = '<p>No active connection.</p>';
    return;
  }
  renderPeopleMap(people);
  personCard.hidden = false;
  consentDetail.hidden = false;
  personName.textContent = person.name;
  personEmail.textContent = person.email;
  personLocation.textContent = person.location ? `Current location: ${formatPlace(person.location)}` : 'Location not detected yet';
  journeySummary.textContent = describeJourney(person);
  distanceTraveled.textContent = formatDistance(person.totalDistanceMeters);
  const updated = person.updatedAt ? new Date(person.updatedAt) : null;
  const timeText = updated ? `Updated ${updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for phone permission';
  lastUpdate.textContent = updated ? 'Just now' : 'Waiting for GPS';
  activityTime.textContent = timeText;
  applySafetyActivity(people);
  personPhoto.textContent = person.name.slice(0, 2).toUpperCase();
  if (person.photo) {
    personPhoto.style.backgroundImage = `url(${person.photo})`;
    personPhoto.style.color = 'transparent';
  }
}

async function refreshPeople() {
  try {
    const response = await fetch(`/api/people${lookupQuery}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load locations');
    const { people } = await response.json();
    if (lookupQuery) lookupMessage.textContent = people.length ? `${people.length} matching connection found.` : 'No active consented connection found.';
    applyPeople(people);
  } catch {
    const initialPeople = window.__INITIAL_PEOPLE__ || [];
    if (initialPeople.length) {
      applyPeople(initialPeople);
      return;
    }
    activeCount.textContent = '0';
    peopleCount.textContent = 'Unavailable';
    renderPeopleMap([]);
    lastUpdate.textContent = 'Server offline';
    window.setTimeout(refreshPeople, 2000);
  }
}

locationLookup.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = lookupEmail.value.trim();
  const phone = lookupPhone.value.trim();
  if (!email && !phone) {
    lookupMessage.textContent = 'Enter an email or phone number to search.';
    return;
  }
  const params = new URLSearchParams();
  if (email) params.set('email', email);
  if (phone) params.set('phone', phone);
  lookupQuery = `?${params}`;
  lookupMessage.textContent = 'Searching active connections...';
  refreshPeople();
});

lookupClear.addEventListener('click', () => {
  lookupEmail.value = '';
  lookupPhone.value = '';
  lookupQuery = '';
  lookupMessage.textContent = '';
  refreshPeople();
});

refreshButton.addEventListener('click', () => {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  lastUpdate.textContent = 'Just now';
  activityTime.textContent = 'Just now';
  refreshButton.querySelector('span').textContent = 'Updated';
  window.setTimeout(() => {
    refreshButton.querySelector('span').textContent = 'Refresh locations';
  }, 1600);
  refreshPeople();
});

initializeAuth().then((authenticated) => {
  if (authenticated) {
    refreshPeople();
    window.setInterval(refreshPeople, 2000);
  }
}).catch(() => { authGate.hidden = false; document.querySelector('.admin-shell').hidden = true; authError.textContent = 'The server is unavailable.'; });

enableEmergencySound.addEventListener('click', enableSound);
document.addEventListener('click', (event) => {
  if (event.target !== enableEmergencySound && localStorage.getItem(emergencySoundKey) === 'true') enableSound();
});
if (localStorage.getItem(emergencySoundKey) === 'true') enableEmergencySound.textContent = 'Enable emergency sound';

setGeofence.addEventListener('click', async () => {
  if (!activePersonId) return;
  const response = await fetch(`/api/geofence/${activePersonId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ radius: Number(geofenceRadius.value) }) });
  geofenceStatus.textContent = response.ok ? `Safety zone: ${geofenceRadius.value} m` : 'Set the zone after a location is available';
  refreshPeople();
});
