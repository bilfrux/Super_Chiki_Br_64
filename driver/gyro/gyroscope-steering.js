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

  // beta/gamma are given in the device's own body frame, not the screen's - rotating
  // the phone 90 degrees into landscape swaps which physical axis is "left/right tilt".
  function readTilt(event) {
    var angle = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle
      : (typeof window.orientation === 'number' ? window.orientation : 0);
    if (angle === 90)  return (event.beta === null || event.beta === undefined) ? null : -event.beta;
    if (angle === -90 || angle === 270) return (event.beta === null || event.beta === undefined) ? null : event.beta;
    return event.gamma; // portrait (0 or 180)
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

    function handleOrientation(event) {
      var tilt = readTilt(event); // left/right tilt in degrees, axis picked for current orientation
      if (tilt === null || tilt === undefined) return;

      if (centerGamma === null) centerGamma = tilt;

      var raw = clamp((tilt - centerGamma) / sensitivity, -1, 1);
      var value = applyDeadZone(raw, deadZone);
      smoothed = smoothed + (value - smoothed) * smoothing; // basic low-pass filter
      if (Math.abs(smoothed) < 0.01) smoothed = 0;          // settle exactly on "straight"
      target.set(smoothed);
    }

    // the phone was physically rotated: which axis is "left/right" just changed, recenter
    function handleOrientationChange() {
      centerGamma = null;
      smoothed = 0;
    }

    return {
      // resolves once listening has started; rejects if unsupported or permission was refused
      start: function () {
        if (!isSupported()) return Promise.reject(new Error('deviceorientation not supported'));
        return requestPermissionIfNeeded().then(function () {
          window.addEventListener('deviceorientation', handleOrientation, true);
          window.addEventListener('orientationchange', handleOrientationChange);
          if (screen.orientation) screen.orientation.addEventListener('change', handleOrientationChange);
        });
      },
      stop: function () {
        window.removeEventListener('deviceorientation', handleOrientation, true);
        window.removeEventListener('orientationchange', handleOrientationChange);
        if (screen.orientation) screen.orientation.removeEventListener('change', handleOrientationChange);
      },
      // treats the phone's current tilt as the new center (call again any time the driver re-grips the phone)
      recalibrate: function () {
        centerGamma = null;
        smoothed = 0;
      },
      isSupported: isSupported
    };
  }

  return { create: create };

})();
