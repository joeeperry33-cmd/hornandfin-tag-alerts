-- Colorado's leftover and reissue PDFs now redirect to a Widen file viewer, so the checker only sees an empty viewer page.
UPDATE sources SET active = 0, last_error = NULL,
  notes = 'Paused: CPW now serves this list through a Widen file viewer with no direct public file link. Ask CPW for a stable direct link (for example a cpw.widen.net/s/ share link) to resume.'
  WHERE id IN ('co-leftover', 'co-reissue');
