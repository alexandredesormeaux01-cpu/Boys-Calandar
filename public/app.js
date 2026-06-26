// Gestion de l'état de l'application
const state = {
  token: localStorage.getItem('token') || null,
  username: localStorage.getItem('username') || null,
  currentDate: new Date(), // Utilisé pour afficher la grille du mois
  myUnavailabilities: [], // Liste des indisponibilités de l'utilisateur connecté
  groupUnavailabilities: [], // Toutes les indisponibilités du groupe
  groupUsers: [], // Liste de tous les utilisateurs
  
  // Gestion de la sélection multiple par glissement (Drag-Select)
  selectedDates: [], // Liste des dates sélectionnées (format YYYY-MM-DD)
  selectedHours: new Set(), // Heures indisponibles communes/courantes pour ces jours (ex: 8, 9...)
  isDragging: false, // Indique si un glissement est en cours
  dragStartDateStr: null, // Date de début du glissement
};

// Éléments du DOM
const DOM = {
  authSection: document.getElementById('auth-section'),
  dashboardSection: document.getElementById('dashboard-section'),
  userProfileHeader: document.getElementById('user-profile-header'),
  headerUsername: document.getElementById('header-username'),
  btnLogout: document.getElementById('btn-logout'),
  
  // Auth Form
  tabLogin: document.getElementById('tab-login'),
  tabRegister: document.getElementById('tab-register'),
  formLogin: document.getElementById('form-login'),
  formRegister: document.getElementById('form-register'),
  authAlert: document.getElementById('auth-alert'),
  
  // Calendar
  calendarTitle: document.getElementById('calendar-title'),
  calendarGrid: document.getElementById('calendar-grid'),
  prevMonth: document.getElementById('prev-month'),
  nextMonth: document.getElementById('next-month'),
  
  // Hours Editor
  hoursEditorPanel: document.getElementById('hours-editor-panel'),
  editorDateTitle: document.getElementById('editor-date-title'),
  editorContentWrapper: document.getElementById('editor-content-wrapper'),
  editorHoursGrid: document.getElementById('editor-hours-grid'),
  
  // Shortcuts
  btnToggleMorning: document.getElementById('btn-toggle-morning'),
  btnToggleAfternoon: document.getElementById('btn-toggle-afternoon'),
  btnToggleEvening: document.getElementById('btn-toggle-evening'),
  btnToggleBlockAll: document.getElementById('btn-toggle-block-all'),
  btnToggleClear: document.getElementById('btn-toggle-clear'),
  
  // Search
  formSearchSlots: document.getElementById('form-search-slots'),
  searchActivity: document.getElementById('search-activity'),
  searchDuration: document.getElementById('search-duration'),
  searchExcludeWeekdaysPM: document.getElementById('search-exclude-weekdays-pm'),
  searchDiscordEveningToggle: document.getElementById('search-discord-evening-toggle'),
  discordEveningFields: document.getElementById('discord-evening-fields'),
  searchDiscordStart: document.getElementById('search-discord-start'),
  searchDiscordEnd: document.getElementById('search-discord-end'),
  searchResultsSection: document.getElementById('search-results-section'),
  searchResultsList: document.getElementById('search-results-list'),
  
  // Stats & Group
  statUserCount: document.getElementById('stat-user-count'),
  statUnavailCount: document.getElementById('stat-unavail-count'),
  groupMemberList: document.getElementById('group-member-list'),
  groupTimelineBar: document.getElementById('group-timeline-bar'),
};

// Helpers de Date locaux pour éviter les bugs de fuseau horaire (Timezone)
function parseLocalDate(dateStr) {
  const parts = dateStr.split('-');
  // Crée une date à minuit local
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

function getLocalTodayStr() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// API Helpers
async function apiRequest(endpoint, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (state.token) {
    headers['Authorization'] = state.token;
  }
  
  const config = { method, headers };
  if (body) {
    config.body = JSON.stringify(body);
  }
  
  const response = await fetch(endpoint, config);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Une erreur est survenue.');
  }
  return data;
}

// Initialisation
async function init() {
  setupEventListeners();
  if (state.token) {
    try {
      const me = await apiRequest('/api/me');
      state.username = me.username;
      showDashboard();
    } catch (e) {
      logout();
    }
  } else {
    showAuth();
  }
}

// Navigation d'écrans
function showAuth() {
  DOM.authSection.classList.remove('hidden');
  DOM.dashboardSection.classList.add('hidden');
  DOM.userProfileHeader.classList.add('hidden');
}

async function showDashboard() {
  DOM.authSection.classList.add('hidden');
  DOM.dashboardSection.classList.remove('hidden');
  DOM.userProfileHeader.classList.remove('hidden');
  DOM.headerUsername.textContent = state.username;
  
  // Sélectionner la date d'aujourd'hui par défaut
  state.selectedDates = [getLocalTodayStr()];
  
  await refreshDashboardData();
  selectDates(state.selectedDates);
}

async function refreshDashboardData() {
  try {
    state.myUnavailabilities = await apiRequest('/api/unavailabilities/my');
    state.groupUnavailabilities = await apiRequest('/api/unavailabilities/group');
    state.groupUsers = await apiRequest('/api/users');
    
    renderCalendar();
    renderGroupPanel();
  } catch (error) {
    console.error('Erreur de chargement des données:', error);
  }
}

function logout() {
  if (state.token) {
    apiRequest('/api/logout', 'POST').catch(() => {});
  }
  state.token = null;
  state.username = null;
  state.selectedDates = [];
  state.selectedHours.clear();
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  showAuth();
}

// Configurer les écouteurs d'événements
function setupEventListeners() {
  // Tabs d'authentification
  DOM.tabLogin.addEventListener('click', () => {
    DOM.tabLogin.classList.add('active');
    DOM.tabRegister.classList.remove('active');
    DOM.formLogin.classList.remove('hidden');
    DOM.formRegister.classList.add('hidden');
    DOM.authAlert.classList.add('hidden');
  });

  DOM.tabRegister.addEventListener('click', () => {
    DOM.tabRegister.classList.add('active');
    DOM.tabLogin.classList.remove('active');
    DOM.formRegister.classList.remove('hidden');
    DOM.formLogin.classList.add('hidden');
    DOM.authAlert.classList.add('hidden');
  });

  // Soumission Connexion
  DOM.formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    DOM.authAlert.classList.add('hidden');
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    try {
      const res = await apiRequest('/api/login', 'POST', { username, password });
      state.token = res.token;
      state.username = res.username;
      localStorage.setItem('token', res.token);
      localStorage.setItem('username', res.username);
      showDashboard();
    } catch (err) {
      DOM.authAlert.textContent = err.message;
      DOM.authAlert.classList.remove('hidden');
    }
  });

  // Soumission Inscription
  DOM.formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    DOM.authAlert.classList.add('hidden');
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    
    try {
      await apiRequest('/api/register', 'POST', { username, password });
      const res = await apiRequest('/api/login', 'POST', { username, password });
      state.token = res.token;
      state.username = res.username;
      localStorage.setItem('token', res.token);
      localStorage.setItem('username', res.username);
      showDashboard();
    } catch (err) {
      DOM.authAlert.textContent = err.message;
      DOM.authAlert.classList.remove('hidden');
    }
  });

  // Déconnexion
  DOM.btnLogout.addEventListener('click', logout);

  // Calendrier Navigation
  DOM.prevMonth.addEventListener('click', () => {
    state.currentDate.setMonth(state.currentDate.getMonth() - 1);
    renderCalendar();
    if (state.selectedDates.length > 0) {
      updateCalendarSelectionFocus();
    }
  });
  DOM.nextMonth.addEventListener('click', () => {
    state.currentDate.setMonth(state.currentDate.getMonth() + 1);
    renderCalendar();
    if (state.selectedDates.length > 0) {
      updateCalendarSelectionFocus();
    }
  });

  // Gestion de la fin du drag globalement
  window.addEventListener('mouseup', () => {
    if (state.isDragging) {
      state.isDragging = false;
      state.dragStartDateStr = null;
    }
  });

  // Afficher/masquer les champs Soirée Discord
  DOM.searchDiscordEveningToggle.addEventListener('change', () => {
    if (DOM.searchDiscordEveningToggle.checked) {
      DOM.discordEveningFields.classList.remove('hidden');
    } else {
      DOM.discordEveningFields.classList.add('hidden');
    }
  });

  // Recherche de créneaux
  DOM.formSearchSlots.addEventListener('submit', async (e) => {
    e.preventDefault();
    const duration = DOM.searchDuration.value;
    const excludeWeekdaysPM = DOM.searchExcludeWeekdaysPM.checked;
    const activityName = DOM.searchActivity.value;

    const body = {
      duration,
      excludeWeekdaysPM
    };

    if (DOM.searchDiscordEveningToggle.checked) {
      body.startRange = DOM.searchDiscordStart.value;
      body.endRange = DOM.searchDiscordEnd.value;
    }

    try {
      const slots = await apiRequest('/api/activities/search', 'POST', body);
      renderSearchResults(slots, activityName);
    } catch (err) {
      alert(err.message);
    }
  });
  
  // Raccourcis de l'éditeur d'heures (sauvegardent automatiquement)
  DOM.btnToggleMorning.addEventListener('click', () => toggleRange(8, 12, true));
  DOM.btnToggleAfternoon.addEventListener('click', () => toggleRange(12, 18, true));
  DOM.btnToggleEvening.addEventListener('click', () => toggleRange(18, 22, true));
  DOM.btnToggleBlockAll.addEventListener('click', () => toggleRange(8, 22, true));
  DOM.btnToggleClear.addEventListener('click', () => toggleRange(8, 22, false));
}

// Gérer le surlignage des dates sélectionnées dans le calendrier
function updateCalendarSelectionFocus() {
  document.querySelectorAll('.calendar-day').forEach(btn => {
    btn.classList.remove('selected-focus');
    if (state.selectedDates.includes(btn.dataset.date)) {
      btn.classList.add('selected-focus');
    }
  });
}

// Sélectionner une ou plusieurs dates pour l'édition
function selectDates(dates) {
  state.selectedDates = dates;
  state.selectedHours.clear();
  
  if (dates.length === 0) {
    DOM.editorDateTitle.textContent = "Sélectionnez un jour";
    DOM.editorContentWrapper.classList.add('disabled-view');
    return;
  }
  
  DOM.editorContentWrapper.classList.remove('disabled-view');
  
  // Formater le titre en évitant les décalages de timezone
  if (dates.length === 1) {
    const formattedDate = parseLocalDate(dates[0]).toLocaleDateString('fr-FR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    DOM.editorDateTitle.textContent = formattedDate;
    
    // Charger les heures de ce jour unique
    const dayUnavail = state.myUnavailabilities.filter(u => u.date === dates[0]);
    dayUnavail.forEach(u => {
      for (let h = u.startHour; h < u.endHour; h++) {
        state.selectedHours.add(h);
      }
    });
  } else {
    // Trier chronologiquement
    const sortedDates = [...dates].sort((a, b) => parseLocalDate(a) - parseLocalDate(b));
    const firstDateStr = parseLocalDate(sortedDates[0]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const lastDateStr = parseLocalDate(sortedDates[sortedDates.length - 1]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    
    DOM.editorDateTitle.textContent = `Du ${firstDateStr} au ${lastDateStr} (${dates.length} jrs)`;
    
    // Charger les indisponibilités : union des heures bloquées
    dates.forEach(dateStr => {
      const dayUnavail = state.myUnavailabilities.filter(u => u.date === dateStr);
      dayUnavail.forEach(u => {
        for (let h = u.startHour; h < u.endHour; h++) {
          state.selectedHours.add(h);
        }
      });
    });
  }
  
  renderHoursEditorGrid();
  updateCalendarSelectionFocus();
  renderGroupTimeline(); // Actualiser la timeline du groupe
}

// Rendu de la grille d'heures
function renderHoursEditorGrid() {
  DOM.editorHoursGrid.innerHTML = '';
  
  for (let h = 8; h < 22; h++) {
    const label = document.createElement('label');
    const isSelected = state.selectedHours.has(h);
    label.className = `hour-checkbox ${isSelected ? 'selected' : ''}`;
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = isSelected;
    
    input.addEventListener('change', async () => {
      if (input.checked) {
        state.selectedHours.add(h);
        label.classList.add('selected');
      } else {
        state.selectedHours.delete(h);
        label.classList.remove('selected');
      }
      
      // Auto-sauvegarde immédiate
      await autoSaveHours();
    });
    
    label.appendChild(document.createTextNode(`${h}h00 - ${h + 1}h00`));
    label.appendChild(input);
    
    DOM.editorHoursGrid.appendChild(label);
  }
}

// Sauvegarde automatique pour TOUTES les dates sélectionnées
async function autoSaveHours() {
  const currentIntervalsTemplate = [];
  const hoursSorted = Array.from(state.selectedHours).sort((a, b) => a - b);
  
  if (hoursSorted.length > 0) {
    let currentStart = hoursSorted[0];
    let currentEnd = currentStart + 1;
    
    for (let i = 1; i < hoursSorted.length; i++) {
      if (hoursSorted[i] === currentEnd) {
        currentEnd++;
      } else {
        currentIntervalsTemplate.push({ startHour: currentStart, endHour: currentEnd });
        currentStart = hoursSorted[i];
        currentEnd = currentStart + 1;
      }
    }
    currentIntervalsTemplate.push({ startHour: currentStart, endHour: currentEnd });
  }
  
  // Conserver les indisponibilités de tous les jours NON sélectionnés
  let filteredUnavailabilities = state.myUnavailabilities.filter(
    u => !state.selectedDates.includes(u.date)
  );
  
  // Pour chaque date sélectionnée, lui appliquer la nouvelle grille d'intervalles
  state.selectedDates.forEach(dateStr => {
    currentIntervalsTemplate.forEach(interval => {
      filteredUnavailabilities.push({
        date: dateStr,
        startHour: interval.startHour,
        endHour: interval.endHour
      });
    });
  });
  
  try {
    const updated = await apiRequest('/api/unavailabilities/my', 'POST', filteredUnavailabilities);
    state.myUnavailabilities = updated;
    
    // Mettre à jour les indisponibilités de groupe
    state.groupUnavailabilities = await apiRequest('/api/unavailabilities/group');
    renderCalendar();
    renderGroupPanel();
    updateCalendarSelectionFocus();
  } catch (err) {
    console.error('Erreur lors de la sauvegarde automatique:', err);
  }
}

// Raccourcis
async function toggleRange(start, end, block) {
  for (let h = start; h < end; h++) {
    if (block) {
      state.selectedHours.add(h);
    } else {
      state.selectedHours.delete(h);
    }
  }
  renderHoursEditorGrid();
  await autoSaveHours();
}

// Rendu du calendrier avec gestion du Drag & Select
function renderCalendar() {
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();
  
  const monthNames = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", 
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
  ];
  DOM.calendarTitle.textContent = `${monthNames[month]} ${year}`;
  
  const firstDayIndex = new Date(year, month, 1).getDay();
  const startDayOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
  const totalDays = new Date(year, month + 1, 0).getDate();
  
  DOM.calendarGrid.innerHTML = '';
  
  for (let i = 0; i < startDayOffset; i++) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'calendar-day empty';
    DOM.calendarGrid.appendChild(emptyDiv);
  }
  
  const todayStr = getLocalTodayStr();

  for (let day = 1; day <= totalDays; day++) {
    const dayButton = document.createElement('button');
    dayButton.className = 'calendar-day';
    dayButton.textContent = day;
    
    const dateObj = new Date(year, month, day);
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    
    dayButton.dataset.date = dateStr;
    
    if (dateStr === todayStr) {
      dayButton.classList.add('today');
    }

    const dayUnavail = state.myUnavailabilities.filter(u => u.date === dateStr);
    
    if (dayUnavail.length > 0) {
      let hoursBlocked = 0;
      dayUnavail.forEach(item => {
        hoursBlocked += (item.endHour - item.startHour);
      });
      
      if (hoursBlocked >= 14) {
        dayButton.classList.add('day-busy');
      } else {
        dayButton.classList.add('day-partial');
      }
    } else {
      dayButton.classList.add('day-free');
    }
    
    // MOUSE DOWN : Démarrer le drag selection
    dayButton.addEventListener('mousedown', (e) => {
      e.preventDefault();
      state.isDragging = true;
      state.dragStartDateStr = dateStr;
      selectDates([dateStr]);
    });
    
    // MOUSE ENTER : Étendre le drag selection
    dayButton.addEventListener('mouseenter', () => {
      if (state.isDragging && state.dragStartDateStr) {
        const partsStart = state.dragStartDateStr.split('-');
        const partsCurr = dateStr.split('-');
        
        if (partsStart[0] === partsCurr[0] && partsStart[1] === partsCurr[1]) {
          const startDayVal = parseInt(partsStart[2], 10);
          const currDayVal = parseInt(partsCurr[2], 10);
          const minDay = Math.min(startDayVal, currDayVal);
          const maxDay = Math.max(startDayVal, currDayVal);
          
          const rangeDates = [];
          for (let d = minDay; d <= maxDay; d++) {
            const formattedD = String(d).padStart(2, '0');
            rangeDates.push(`${partsStart[0]}-${partsStart[1]}-${formattedD}`);
          }
          selectDates(rangeDates);
        }
      }
    });
    
    // MOUSE UP : Finir le drag selection sur ce jour
    dayButton.addEventListener('mouseup', () => {
      if (state.isDragging) {
        state.isDragging = false;
        state.dragStartDateStr = null;
      }
    });
    
    DOM.calendarGrid.appendChild(dayButton);
  }
}

// Rendu groupe & timeline
function renderGroupPanel() {
  DOM.statUserCount.textContent = state.groupUsers.length;
  
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  
  const monthUnavailabilities = state.groupUnavailabilities.filter(u => u.date.startsWith(prefix));
  DOM.statUnavailCount.textContent = monthUnavailabilities.length;
  
  DOM.groupMemberList.innerHTML = '';
  
  const adminUsername = 'alexandre.desormeaux01@gmail.com';
  const isAdmin = state.username && state.username.toLowerCase() === adminUsername.toLowerCase();
  
  state.groupUsers.forEach(username => {
    const li = document.createElement('li');
    li.className = 'member-item';
    
    let htmlContent = `<div class="member-info"><i data-lucide="user" style="width:14px;color:var(--primary-color)"></i> <span>${username}</span></div>`;
    
    // Si connecté en tant qu'admin et ce n'est pas son propre compte
    if (isAdmin && username.toLowerCase() !== adminUsername.toLowerCase()) {
      htmlContent += `<button class="btn-eject" title="Éjecter ce membre" data-username="${username}"><i data-lucide="user-minus" style="width:14px;height:14px;"></i></button>`;
    }
    
    li.innerHTML = htmlContent;
    DOM.groupMemberList.appendChild(li);
  });
  
  // Attacher les écouteurs de clic pour l'éjection
  if (isAdmin) {
    DOM.groupMemberList.querySelectorAll('.btn-eject').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const username = btn.dataset.username;
        if (confirm(`Voulez-vous vraiment éjecter ${username} du groupe ? Toutes ses données seront supprimées.`)) {
          try {
            await apiRequest(`/api/users/${encodeURIComponent(username)}`, 'DELETE');
            await refreshDashboardData();
          } catch (err) {
            alert('Erreur lors de l\'éjection : ' + err.message);
          }
        }
      });
    });
  }
  
  renderGroupTimeline();
  lucide.createIcons();
}

function renderGroupTimeline() {
  DOM.groupTimelineBar.innerHTML = '';
  // Utiliser la première date sélectionnée ou aujourd'hui
  const activeDate = (state.selectedDates && state.selectedDates.length > 0) 
    ? state.selectedDates[0] 
    : getLocalTodayStr();
  
  const activeUnavailabilities = state.groupUnavailabilities.filter(u => u.date === activeDate);
  
  for (let hour = 8; hour < 22; hour++) {
    const segment = document.createElement('div');
    segment.className = 'timeline-segment';
    
    const isBlocked = activeUnavailabilities.some(u => hour >= u.startHour && hour < u.endHour);
    
    if (isBlocked) {
      segment.classList.add('blocked');
      const names = activeUnavailabilities
        .filter(u => hour >= u.startHour && hour < u.endHour)
        .map(u => u.username);
      segment.title = `${hour}h - ${hour + 1}h : Occupé par ${names.join(', ')}`;
    } else {
      segment.title = `${hour}h - ${hour + 1}h : Tout le monde est libre`;
    }
    
    DOM.groupTimelineBar.appendChild(segment);
  }
}

// Résultats de recherche
function renderSearchResults(slots, activityName) {
  DOM.searchResultsList.innerHTML = '';
  
  if (slots.length === 0) {
    DOM.searchResultsList.innerHTML = '<div class="result-card" style="justify-content: center; color: var(--text-muted)">Aucun créneau commun trouvé pour cette durée.</div>';
    DOM.searchResultsSection.classList.remove('hidden');
    return;
  }
  
  slots.forEach(slot => {
    const card = document.createElement('div');
    card.className = 'result-card';
    
    const formattedDate = parseLocalDate(slot.date).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    
    card.innerHTML = `
      <div class="result-date-info">
        <span class="r-date">${formattedDate}</span>
        <span class="r-day">${slot.dayOfWeek}</span>
      </div>
      <div class="result-time">
        ${slot.startHour}h00 - ${slot.endHour}h00
      </div>
    `;
    
    DOM.searchResultsList.appendChild(card);
  });
  
  DOM.searchResultsSection.classList.remove('hidden');
}

// Démarrer l'application
init();

// Rafraîchir les données de groupe toutes les 10 secondes automatiquement
setInterval(() => {
  if (state.token) {
    refreshDashboardData();
  }
}, 10000);

