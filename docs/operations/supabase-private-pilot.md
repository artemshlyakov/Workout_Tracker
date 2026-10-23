# Supabase Auth — настройка закрытого личного пилота (без SMTP)

> Supabase-проект создан в Plan 003A; согласованная миграция применена через Supabase MCP. Из доступных инструментов нельзя изменить настройки Auth; ниже отмечены минимальные действия владельца в Dashboard. Названия пунктов UI могут меняться.

1. Проект `workout-tracker` (`snnlibzckwpmbkersdnm`) уже создан в Free-организации. Никому не передавай project database password или service_role/secret key.
2. В разделе **Authentication → Providers → Email** оставь email/password включённым и отключи **Confirm Email**. Помни: теперь Supabase *автоматически помечает* email подтверждённым без действительной проверки.
3. В настройках Authentication разреши **Allow new users to sign up** только на время регистрации первого владельца. Открой приложение с `?signup=1` для показа формы; этот параметр не заменяет серверное разрешение Supabase.
4. Зарегистрируйся с **реальным доступным email**, уникальным сильным паролем (рекомендовано 12+ символов) и запиши его в менеджер паролей. Убедись, что signUp возвращает session, а вход и выход работают.
5. Отключи **Allow new users to sign up**. Убедись на отдельном сеансе, что новый email зарегистрировать нельзя, но ранее созданный аккаунт входит.
6. Миграция уже применена; RLS и grants проверены по облачному SQL-каталогу. Прямые REST запросы A/B/anon ещё не проверены: для тестового B временно открой signup, создай B и повторно закрой. Не используй приложение до успешных проверок.
7. На GitHub Pages публикуй **только** собранный Vite frontend из `dist`. Публичные Supabase URL и publishable key уже находятся в браузерном клиенте. **Никогда** не публикуй `service_role`, пароль к БД, секреты SMTP и refresh/access токены.
8. В GitHub Settings → Pages → Build and deployment выбери Source: **GitHub Actions**. Если выбран `Deploy from a branch`, Pages публикует исходный TypeScript и приложение выглядит пустым. После переключения проверь последний run `.github/workflows/deploy.yml` и адрес `https://artemshlyakov.github.io/Workout_Tracker/`.
9. Пока не включена доставляемая почта, **не обещай email password reset**. Если потеряешь пароль после выхода, обычный способ восстановления не будет работать. Держи регулярный экспорт тренировок и не теряй пароль.
10. Если позднее захочешь приглашать пользователей, отдельно включим verified-email + SMTP или OAuth. Не думай, что старые `auto-confirmed` записи доказывают владение email.

Ссылки:
- https://supabase.com/docs/guides/auth/general-configuration
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/database/postgres/row-level-security
