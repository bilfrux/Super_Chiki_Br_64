/**
 * GyroscopeSteering
 *
 * Reads the phone's left/right tilt (deviceorientation) and reports a
 * calibrated steering value through the SAME interface the racer's
 * SteeringInput already exposes: target.set(value), value in [-1, 1].
 *
 * This module contains NO driving logic - it only converts tilt into a
 * number and hands it to whatever `target` it is given. Today that target is
 * a local, on-page SteeringInput used only to prove the pipeline works
 * (see index.html's test mode). Later, `target` can be the real racer
 * SteeringInput delivered over the network - this file does not change.
 */
var GyroscopeSteering = (function () {

  var SENSITIVITY = 25; // degrees of tilt from center that map to full lock (-1 or +1)
  var DEAD_ZONE   = 0.06; // |value| below this counts as "straight" (hand tremor, sensor noise); the rest is rescaled so full lock is still 1
  var SMOOTHING   = 0.35; // 0..1: how much of the new reading is taken per event (1 = raw, lower = smoother but slower)

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isSupported() {
    return typeof window.DeviceOrientationEvent !== 'undefined';
  }

  // beta/gamma are given in the device's own body frame, not the screen's, so which one
  // is "left/right tilt" depends on how the phone is physically held. screen.orientation.angle
  // looks like the right way to detect that, but it reflects the OS's rotation-lock state, not
  // the phone's actual physical orientation - with rotation lock on (a common default) it stays
  // frozen at "portrait" even while the phone is held sideways, silently breaking steering. So
  // this is an explicit mode set by the driver page instead of an auto-detected one.
  var AXIS_MODES = { portrait: 1, landscape: 1, 'landscape-flip': 1 };

  function tiltFor(mode, event) {
    if (mode === 'landscape')      return (event.beta === null || event.beta === undefined) ? null : -event.beta;
    if (mode === 'landscape-flip') return (event.beta === null || event.beta === undefined) ? null : event.beta;
    return event.gamma; // 'portrait'
  }

  function requestPermissionIfNeeded() {
    // iOS 13+ requires an explicit, user-gesture-triggered permission request.
    // Android / older Safari / desktop browsers do not have this method at all.
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      return DeviceOrientationEvent.requestPermission().then(function (result) {
        if (result !== 'granted') throw new Error('gyroscope permission denied');
      });
    }
    return Promise.resolve();
  }

  // dead zone + rescale: 0 inside the zone, then a straight ramp to +-1 so full lock is unchanged
  function applyDeadZone(value, zone) {
    var a = Math.abs(value);
    if (a <= zone) return 0;
    return (value < 0 ? -1 : 1) * ((a - zone) / (1 - zone));
  }

  // options (all optional): { sensitivity: degrees to full lock, deadZone: 0..0.5, smoothing: 0..1 }
  function create(target, options) {
    options = options || {};
    var sensitivity = options.sensitivity || SENSITIVITY;
    var deadZone    = options.deadZone !== undefined ? options.deadZone : DEAD_ZONE;
    var smoothing   = options.smoothing !== undefined ? options.smoothing : SMOOTHING;
    var smoothed    = 0;
    var centerGamma = null; // calibration baseline - the first reading becomes "center"
    var axisMode    = AXIS_MODES[options.axisMode] ? options.axisMode : 'portrait';

    function handleOrientation(event) {
      var tilt = tiltFor(axisMode, event); // left/right tilt in degrees, axis picked by the current mode
      if (tilt === null || tilt === undefined) return;

      if (centerGamma === null) centerGamma = tilt;

      var raw = clamp((tilt - centerGamma) / sensitivity, -1, 1);
      var value = applyDeadZone(raw, deadZone);
      smoothed = smoothed + (value - smoothed) * smoothing; // basic low-pass filter
      if (Math.abs(smoothed) < 0.01) smoothed = 0;          // settle exactly on "straight"
      target.set(smoothed);
    }

    return {
      // resolves once listening has started; rejects if unsupported or permission was refused
      start: function () {
        if (!isSupported()) return Promise.reject(new Error('deviceorientation not supported'));
        return requestPermissionIfNeeded().then(function () {
          window.addEventListener('deviceorientation', handleOrientation, true);
        });
      },
      stop: function () {
        window.removeEventListener('deviceorientation', handleOrientation, true);
      },
      // treats the phone's current tilt as the new center (call again any time the driver re-grips the phone)
      recalibrate: function () {
        centerGamma = null;
        smoothed = 0;
      },
      // 'portrait' | 'landscape' | 'landscape-flip' - switches which sensor axis counts as left/right
      // and recenters. Driven by an explicit UI control, not auto-detection (see note above).
      setAxisMode: function (mode) {
        if (!AXIS_MODES[mode]) return;
        axisMode = mode;
        centerGamma = null;
        smoothed = 0;
      },
      getAxisMode: function () { return axisMode; },
      isSupported: isSupported
    };
  }

  return { create: create };

})();
