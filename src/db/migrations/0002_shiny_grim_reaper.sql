CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`ekos_user_id` text NOT NULL,
	`corporate_username` text NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text,
	`access_token_exp` integer,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
