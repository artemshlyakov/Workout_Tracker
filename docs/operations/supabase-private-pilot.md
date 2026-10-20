# Supabase Auth — настройка закрытого личного пилота (без SMTP)

> Это **план действий для владельца** в Supabase Dashboard, а не автоматическая операция Codex. Настройки в UI могут меняться: ориентируйся на названия возможностей, а не на фиксированный путь.

1. Создай **Free** проект Supabase. Никому не передавай project database password или service_role/secret key.
2. В разделе **Authentication → Providers → Email** оставь email/password включённым и отключи **Confirm Email**. Помни: теперь Supabase *автоматически помечает* email подтверждённым без действительной проверки.
3. В настройках Authentication разреши **Allow new users to sign up** только на время регистрации первого владельца. Подготовь форму, использующую `supabase.auth.signUp({ email, password })`.
4. Зарегистрируйся с **реальным доступным email**, уникальным сильным паролем (рекомендовано 12+ символов) и запиши его в менеджер паролей. Убедись, что signUp возвращает session, а вход и выход работают.
5. Отключи **Allow new users to sign up**. Убедись на отдельном сеансе, что новый email зарегистрировать нельзя, но ранее созданный аккаунт входит.
6. Настрой **RLS и grants** на всех пользовательских таблицах; проверь User A, User B и anon, включая прямые REST запросы. Для тестового B временно открой signup, создай B и повторно закрой.
7. На GitHub Pages публикуй **только** Vite frontend с `VITE_SUPABASE_URL` и publishable key. **Никогда** не публикуй `service_role`, пароль к БД, секреты SMTP и refresh/access токены.
8. Пока не включена доставляемая почта, **не обещай email password reset**. Если потеряешь пароль после выхода, обычный способ восстановления не будет работать. Держи регулярный экспорт тренировок и не теряй пароль.
9. Если позднее захочешь приглашать пользователей, отдельно включим verified-email + SMTP или OAuth. Не думай, что старые `auto-confirmed` записи доказывают владение email.

Ссылки:
- https://supabase.com/docs/guides/auth/general-configuration
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/database/postgres/row-level-security
