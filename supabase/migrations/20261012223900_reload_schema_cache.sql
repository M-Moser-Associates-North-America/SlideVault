-- Force PostgREST to reload its schema cache immediately rather than waiting for the
-- platform's automatic reload, which lagged noticeably after the previous migration.
notify pgrst, 'reload schema';
