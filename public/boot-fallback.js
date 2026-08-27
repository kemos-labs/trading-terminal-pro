// Show fallback only if React never mounts (asset/CORS failure).
setTimeout(function () {
  var root = document.getElementById('root');
  var fb = document.getElementById('boot-fallback');
  if (root && fb && !root.childElementCount) fb.classList.add('show');
}, 4000);
