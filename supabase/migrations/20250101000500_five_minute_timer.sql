-- Answer window: 5 minutes, so nobody feels rushed and longer videos fit.
alter table app_settings alter column answer_window_seconds set default 300;
update app_settings set answer_window_seconds = 300 where id = 1;
