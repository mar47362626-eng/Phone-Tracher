const form = document.querySelector('#registrationForm');
const connectedState = document.querySelector('#connectedState');
const graphicName = document.querySelector('#graphicName');
const graphicStatus = document.querySelector('#graphicStatus');
const graphicCaption = document.querySelector('#graphicCaption');
const fullName = document.querySelector('#fullName');
const formError = document.querySelector('#formError');
const stopSharing = document.querySelector('#stopSharing');
const photoInput = document.querySelector('#photo');
const photoPreview = document.querySelector('#photoPreview');
const photoLabel = document.querySelector('#photoLabel');
const locationTitle = document.querySelector('#locationTitle');
const locationCoordinates = document.querySelector('#locationCoordinates');
const connectedAvatar = document.querySelector('#connectedAvatar');
const recipientPhoto = document.querySelector('#recipientPhoto');
const sosButton = document.querySelector('#sosButton');
const checkInButton = document.querySelector('#checkInButton');
const checkinInterval = document.querySelector('#checkinInterval');
const evidenceInput = document.querySelector('#evidenceInput');
const safetyStatus = document.querySelector('#safetyStatus');
let locationWatchId = null;
let checkinTimer = null;
let latestPlaceRequest = 0;
let sharingPersonId = null;
const sharingStorageKey = 'heretogether-sharing-person';

const readSelectedPhoto = () => new Promise((resolve) => {
  const [file] = photoInput.files;
  if (!file) return resolve('');
  const reader = new FileReader();
  reader.addEventListener('load', () => resolve(reader.result));
  reader.addEventListener('error', () => resolve(''));
  reader.readAsDataURL(file);
});

photoInput.addEventListener('change', () => {
  const [file] = photoInput.files;
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    photoPreview.style.backgroundImage = `url(${reader.result})`;
    photoPreview.textContent = '';
    photoPreview.classList.add('has-photo');
    photoLabel.textContent = file.name;
    recipientPhoto.src = reader.result;
    recipientPhoto.classList.add('has-photo');
  });
  reader.readAsDataURL(file);
});

const updateLocation = (position) => {
  const { latitude, longitude, accuracy } = position.coords;
  if (sharingPersonId) {
    fetch(`/api/location/${sharingPersonId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ latitude, longitude, accuracy }) }).catch(() => {});
  }
  locationTitle.textContent = 'Location detected';
  locationCoordinates.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)} · within ${Math.round(accuracy)} m`;
  graphicCaption.textContent = 'Live location · updating now';
  const requestId = ++latestPlaceRequest;
  fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`)
    .then((response) => response.ok ? response.json() : null)
    .then((place) => {
      if (requestId !== latestPlaceRequest || !place?.display_name) return;
      const readablePlace = place.display_name.split(',').slice(0, 2).join(',');
      locationTitle.textContent = readablePlace;
      graphicCaption.textContent = `Live location · ${readablePlace}`;
    })
    .catch(() => {});
};

const detectLocation = () => {
  if (!navigator.geolocation) {
    locationTitle.textContent = 'Location is not supported';
    locationCoordinates.textContent = 'Please use a browser with location services enabled.';
    return;
  }

  locationWatchId = navigator.geolocation.watchPosition(
    updateLocation,
    () => {
      locationTitle.textContent = 'Location access was declined';
      locationCoordinates.textContent = 'Sharing is on, but your place stays hidden until you allow location access.';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
};

const showConnectedState = (person, photoData = person.photo || '') => {
  sharingPersonId = person.id;
  localStorage.setItem(sharingStorageKey, sharingPersonId);
  graphicName.textContent = person.name;
  graphicStatus.textContent = 'Sharing live';
  graphicCaption.textContent = 'Your location is now visible to Sam';
  connectedState.hidden = false;
  form.hidden = true;
  document.querySelector('.recipient-person').classList.add('is-live');
  connectedAvatar.textContent = person.name.slice(0, 1).toUpperCase();
  if (photoData) {
    connectedAvatar.style.backgroundImage = `url(${photoData})`;
    connectedAvatar.textContent = '';
    connectedAvatar.classList.add('has-photo');
  }
  detectLocation();
};

const restoreSharing = async () => {
  const savedPersonId = localStorage.getItem(sharingStorageKey);
  if (!savedPersonId) return;
  try {
    const response = await fetch(`/api/connection/${savedPersonId}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Connection not found');
    const { person } = await response.json();
    showConnectedState(person);
  } catch {
    // Keep the form visible if the server is unavailable.
  }
};

const postSafetyEvent = async (type, body = {}) => {
  if (!sharingPersonId) throw new Error('No active sharing connection');
  const response = await fetch(`/api/${type}/${sharingPersonId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Safety event failed');
  }
  return response.json();
};

const sendCheckIn = () => postSafetyEvent('checkin').then(() => { safetyStatus.textContent = 'Check-in sent to Sam.'; }).catch(() => { safetyStatus.textContent = 'Check-in could not be sent.'; });

sosButton.addEventListener('click', () => {
  if (!window.confirm('Send an emergency SOS alert to Sam?')) return;
  sosButton.disabled = true;
  sosButton.textContent = 'Sending SOS...';
  postSafetyEvent('sos').then(() => {
    safetyStatus.textContent = 'SOS alert sent to the admin.';
    sosButton.textContent = 'SOS alert sent';
  }).catch(() => {
    safetyStatus.textContent = 'SOS alert could not be sent. Try again.';
    sosButton.disabled = false;
    sosButton.textContent = 'Send SOS alert';
  });
});

checkInButton.addEventListener('click', sendCheckIn);
checkinInterval.addEventListener('change', () => {
  if (checkinTimer) window.clearInterval(checkinTimer);
  const minutes = Number(checkinInterval.value);
  if (minutes) checkinTimer = window.setInterval(sendCheckIn, minutes * 60 * 1000);
  safetyStatus.textContent = minutes ? `Automatic check-ins set for every ${minutes} minutes.` : 'Automatic check-ins are off.';
});

evidenceInput.addEventListener('change', () => {
  const [file] = evidenceInput.files;
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => postSafetyEvent('evidence', { image: reader.result, name: file.name }).then(() => { safetyStatus.textContent = 'Evidence was shared with Sam.'; }).catch(() => { safetyStatus.textContent = 'Evidence could not be shared.'; }));
  reader.readAsDataURL(file);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const phoneDigits = document.querySelector('#phone').value.replace(/\D/g, '');
  const email = document.querySelector('#email').value.trim();

  if (!fullName.value.trim() || !email || !email.includes('@') || phoneDigits.length < 7 || !document.querySelector('#consent').checked) {
    formError.textContent = 'Please complete your name, email, phone number, and consent before continuing.';
    return;
  }

  formError.textContent = '';
  const photoData = await readSelectedPhoto();
  let registration;
  try {
    registration = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fullName.value.trim(), email, phone: document.querySelector('#phone').value.trim(), consent: true, photo: photoData }) });
  } catch {
    formError.textContent = 'The server is unavailable. Please start it with node server.js and try again.';
    return;
  }
  if (!registration.ok) {
    formError.textContent = 'The connection could not be created. Please try again.';
    return;
  }
  const { person } = await registration.json();
  showConnectedState(person, photoData);
});

stopSharing.addEventListener('click', () => {
  if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId);
  if (checkinTimer) window.clearInterval(checkinTimer);
  locationWatchId = null;
  checkinTimer = null;
  if (sharingPersonId) fetch(`/api/stop/${sharingPersonId}`, { method: 'POST' }).catch(() => {});
  localStorage.removeItem(sharingStorageKey);
  sharingPersonId = null;
  connectedState.hidden = true;
  form.hidden = false;
  document.querySelector('#consent').checked = false;
  graphicName.textContent = 'You';
  graphicStatus.textContent = 'Awaiting registration';
  graphicCaption.textContent = 'Your location is hidden until you consent';
  document.querySelector('.recipient-person').classList.remove('is-live');
  locationTitle.textContent = 'Detecting your location...';
  locationCoordinates.textContent = 'Allow location access to show your place.';
  connectedAvatar.style.backgroundImage = '';
  connectedAvatar.textContent = '+';
  connectedAvatar.classList.remove('has-photo');
  recipientPhoto.removeAttribute('src');
  recipientPhoto.classList.remove('has-photo');
});

restoreSharing();