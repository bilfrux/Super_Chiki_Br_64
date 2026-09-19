MEME BILLBOARDS
===============

Drop your meme images in THIS folder (game/assets/memes/) and they replace the billboards along the race track.

NAMING (required)
  meme1.png
  meme2.jpg
  meme3.png
  ...
  Number them from 1 with no gaps: the list stops at the first missing number (meme4 missing => meme5 is not loaded).
  Up to 30 images. The number order is the order they appear along the road; after the last one it starts over.

FORMATS
  .png and .jpg are supported and tested. .jpeg, .webp and .gif are also tried, but the server labels them with a
  generic file type, so stick to .png / .jpg for the live demo. (GIFs would show as a still image, not animated.)

SIZE
  Any size works: the image is scaled to fit inside a wooden sign (nothing is cropped or stretched; the rest of
  the sign is black). Landscape images (3:2 or 16:9, around 600x400) look best. Keep each file under ~300 KB so
  the page loads quickly on the big screen.

AFTER ADDING / CHANGING FILES
  Just reload the race screen (Ctrl+F5). No build, no server restart: the server always serves the newest file.
  The browser console (F12) prints "[MemeBoards] N meme image(s) on M billboard(s)" when they are picked up.

NO IMAGES HERE?
  Then nothing changes: the original billboards are used.

TUNING (optional)
  game/race/meme-billboards.js, top of the file: MEME_EVERY = 1 means every billboard shows a meme; 2 means every
  second billboard, 3 every third, and so on.
