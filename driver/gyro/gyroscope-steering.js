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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isSupported() {
    return typeof window.DeviceOrientationEvent !== 'undefined';
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

  function create(target) {
    var centerGamma = null; // calibration baseline - the first reading becomes "center"

    function handleOrientation(event) {
      var gamma = event.gamma; // left/right tilt in degrees (~ -90..90 on most phones)
      if (gamma === null || gamma === undefined) return;

      if (centerGamma === null) centerGamma = gamma;

      var value = clamp((gamma - centerGamma) / SENSITIVITY, -1, 1);
      target.set(value);
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
      },
      isSupported: isSupported
    };
  }

  return { create: create };

})();
