CREATE TABLE `user_directory` (
	`corporate_username` text PRIMARY KEY NOT NULL,
	`ekos_user_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`department_ids` text NOT NULL,
	`brand_ids` text NOT NULL,
	`permissions` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`tenant_id` text DEFAULT 'tenant_default' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
