# Supabase Auth — настройка закрытого личного пилота (без SMTP)

> Supabase-проект создан агентом в Plan 003A. Агент подготовил SQL, но применит его только после согласования владельца. Из доступных инструментов нельзя изменить настройки Auth; ниже отмечены минимальные действия владельца в Dashboard. Названия пунктов UI могут меняться.

1. Проект `workout-tracker` (`snnlibzckwpmbkersdnm`) уже создан в Free-организации. Никому не передавай project database password или service_role/secret key.
2. В разделе **Authentication → Providers → Email** оставь email/password включённым и отключи **Confirm Email**. Помни: теперь Supabase *автоматически помечает* email подтверждённым без действительной проверки.
3. В настройках Authentication разреши **Allow new users to sign up** только на время регистрации первого владельца. Подготовь форму, использующую `supabase.auth.signUp({ email, password })`.
4. Зарегистрируйся с **реальным доступным email**, уникальным сильным паролем (рекомендовано 12+ символов) и запиши его в менеджер паролей. Убедись, что signUp возвращает session, а вход и выход работают.
5. Отключи **Allow new users to sign up**. Убедись на отдельном сеансе, что новый email зарегистрировать нельзя, но ранее созданный аккаунт входит.
6. После ревью SQL агент применит миграцию и проверит **RLS и grants** на всех пользовательских таблицах, включая прямые REST запросы A/B/anon. Для тестового B временно открой signup, создай B и повторно закрой. Не используй приложение до успешных проверок.
7. На GitHub Pages публикуй **только** Vite frontend с `VITE_SUPABASE_URL` и publishable key. **Никогда** не публикуй `service_role`, пароль к БД, секреты SMTP и refresh/access токены.
8. Пока не включена доставляемая почта, **не обещай email password reset**. Если потеряешь пароль после выхода, обычный способ восстановления не будет работать. Держи регулярный экспорт тренировок и не теряй пароль.
9. Если позднее захочешь приглашать пользователей, отдельно включим verified-email + SMTP или OAuth. Не думай, что старые `auto-confirmed` записи доказывают владение email.

Ссылки:
- https://supabase.com/docs/guides/auth/general-configuration
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/database/postgres/row-level-security
