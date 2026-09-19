/**
 * Meme billboards for the race track (cosmetic only).
 *
 * Drop images into  game/assets/memes/  named  meme1.png, meme2.jpg, meme3.png ...  (see README.txt there).
 * Every billboard sign along the road then shows one of your images, in order (meme1, meme2, ... then it
 * loops). With no images in the folder nothing changes and the original signs are used.
 *
 * This file does not touch physics, networking or the race. The racer keeps each billboard's ORIGINAL
 * rectangle for size and collisions; we only swap the picture that is drawn there (test/v5.teams.html,
 * three small hooks: script tag, MemeBoards.init(...) after the road is built, and the sprite draw call).
 */
var MemeBoards = (function () {
  var FOLDER     = '/game/assets/memes/'; // where you drop the images (served by the server as /game/...)
  var PREFIX     = 'meme';                // meme1.png, meme2.jpg, ...
  var EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
  var MAX_IMAGES = 30;
  var MEME_EVERY = 1;                     // 1 = every billboard shows a meme, 2 = every second one, 3 = every third ...

  var images = [];   // loaded <img> elements, in file-number order
  var boards = {};   // cache: "<imageIndex>_<w>x<h>" -> ready-to-draw canvas (one per image and billboard size)

  function tryLoad(url, done) {
    var img = new Image();
    img.onload  = function () { done(img); };
    img.onerror = function () { done(null); };
    img.src = url;
  }

  // meme<n>.<ext>: the first extension that exists wins; the first number with no file ends the list
  function loadNext(n, ext, done) {
    if (n > MAX_IMAGES) return done();
    if (ext >= EXTENSIONS.length) return done(); // no file for this number: stop here
    tryLoad(FOLDER + PREFIX + n + '.' + EXTENSIONS[ext], function (img) {
      if (img && img.naturalWidth > 0) { images.push(img); loadNext(n + 1, 0, done); }
      else loadNext(n, ext + 1, done);
    });
  }

  // A billboard is drawn from a canvas the same size as the original sign: a wooden frame and two posts
  // (the originals have posts too), with the image scaled to FIT inside so nothing is cropped or stretched.
  function boardFor(index, w, h) {
    var key = index + '_' + w + 'x' + h;
    if (boards[key]) return boards[key];
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    var legH = Math.round(h * 0.22), boardH = h - legH, m = Math.max(4, Math.round(Math.min(w, boardH) * 0.05));

    g.fillStyle = '#5a3a1a';                                  // posts
    g.fillRect(Math.round(w * 0.16), boardH - 2, Math.round(w * 0.05), legH + 2);
    g.fillRect(Math.round(w * 0.79), boardH - 2, Math.round(w * 0.05), legH + 2);
    g.fillStyle = '#3a2410';                                  // frame
    g.fillRect(0, 0, w, boardH);
    g.fillStyle = '#0d0d0d';                                  // picture background (letterbox)
    g.fillRect(m, m, w - 2 * m, boardH - 2 * m);

    var img = images[index], iw = img.naturalWidth, ih = img.naturalHeight;
    var s = Math.min((w - 2 * m) / iw, (boardH - 2 * m) / ih);
    var dw = iw * s, dh = ih * s;
    g.drawImage(img, m + ((w - 2 * m) - dw) / 2, m + ((boardH - 2 * m) - dh) / 2, dw, dh);

    c.mgpRect = { x: 0, y: 0, w: w, h: h }; // what Render.sprite draws: the whole canvas
    boards[key] = c;
    return c;
  }

  // Walk the road in order; give every MEME_EVERY-th billboard the next image. Safe to call more than once.
  function apply(segments) {
    if (!images.length || !segments || typeof SPRITES === 'undefined') return 0;
    var billboards = SPRITES.BILLBOARDS, seen = 0, used = 0, i, j, sp;
    for (i = 0; i < segments.length; i++) {
      for (j = 0; j < segments[i].sprites.length; j++) {
        sp = segments[i].sprites[j];
        if (billboards.indexOf(sp.source) < 0) continue;
        if (seen++ % MEME_EVERY !== 0) { sp.meme = null; continue; }
        sp.meme = boardFor(used++ % images.length, sp.source.w, sp.source.h);
      }
    }
    return used;
  }

  // Load the images, then decorate the road. getSegments() returns the racer's current segments array.
  function init(getSegments, done) {
    loadNext(1, 0, function () {
      var used = apply(getSegments());
      if (window.console && images.length) console.log('[MemeBoards] ' + images.length + ' meme image(s) on ' + used + ' billboard(s)');
      if (done) done(images.length);
    });
  }

  return { init: init, apply: apply, count: function () { return images.length; } };
})();
