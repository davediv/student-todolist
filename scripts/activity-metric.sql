-- ISO weeks run Monday-Sunday; the ISO year can differ from the calendar year.
-- activity_days has one row per student and local calendar date.
SELECT
  u.id AS user_id,
  u.email,
  strftime('%G-W%V', a.date) AS iso_week,
  COUNT(*) AS days_used,
  COUNT(*) >= 3 AS meets_goal
FROM activity_days AS a
JOIN user AS u ON u.id = a.user_id
GROUP BY u.id, u.email, iso_week
ORDER BY iso_week, u.email;
