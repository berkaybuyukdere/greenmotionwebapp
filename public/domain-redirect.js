/**
 * Legacy Firebase Hosting domains → canonical custom domain.
 * firebaseapp.com / web.app cannot be removed from the Firebase project.
 */
(function () {
  var canonicalOrigin = 'https://vehiclesentinel.com';
  var legacyHosts = {
    'greenmotionapp-33413.firebaseapp.com': true,
    'greenmotionapp-33413.web.app': true,
  };
  if (!legacyHosts[window.location.hostname]) return;
  window.location.replace(
    canonicalOrigin + window.location.pathname + window.location.search + window.location.hash
  );
})();
