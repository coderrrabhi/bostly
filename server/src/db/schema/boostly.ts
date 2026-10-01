import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const appRoleEnum = pgEnum("app_role", ["admin", "moderator", "user"]);

// Clerk user IDs are strings, so all ownership keys deliberately use text rather
// than the UUID references that formerly pointed at Supabase auth.users.
export const profilesTable = pgTable("profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().unique(),
  email: text("email").notNull(),
  fullName: text("full_name"),
  apiKey: text("api_key"),
  currency: text("currency").notNull().default("USD"),
  ...timestamps,
});

export const userRolesTable = pgTable("user_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().unique(),
  role: appRoleEnum("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletsTable = pgTable("wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().unique(),
  balance: numeric("balance", { precision: 14, scale: 4 }).notNull().default("0"),
  totalDeposited: numeric("total_deposited", { precision: 14, scale: 4 }).notNull().default("0"),
  totalSpent: numeric("total_spent", { precision: 14, scale: 4 }).notNull().default("0"),
  ...timestamps,
});

export const providersTable = pgTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  apiUrl: text("api_url").notNull(),
  // Provider credentials are server-only. No public route returns this table.
  apiKey: text("api_key").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const servicesTable = pgTable("services", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: text("provider_id").references(() => providersTable.id, { onDelete: "cascade" }),
  providerServiceId: text("provider_service_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 14, scale: 4 }).notNull().default("0"),
  minQuantity: integer("min_quantity").notNull().default(10),
  maxQuantity: integer("max_quantity").notNull().default(100000),
  speed: text("speed").notNull().default("medium"),
  quality: text("quality").notNull().default("standard"),
  dripFeedEnabled: boolean("drip_feed_enabled").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const ordersTable = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderNumber: integer("order_number").generatedAlwaysAsIdentity().unique(),
  userId: text("user_id").notNull(),
  serviceId: uuid("service_id").references(() => servicesTable.id, { onDelete: "set null" }),
  link: text("link").notNull(),
  quantity: integer("quantity").notNull(),
  price: numeric("price", { precision: 14, scale: 4 }).notNull(),
  status: text("status").notNull().default("pending"),
  startCount: integer("start_count"),
  remains: integer("remains"),
  providerOrderId: text("provider_order_id"),
  isDripFeed: boolean("is_drip_feed").notNull().default(false),
  dripRuns: integer("drip_runs"),
  dripInterval: integer("drip_interval"),
  dripIntervalUnit: text("drip_interval_unit"),
  isOrganicMode: boolean("is_organic_mode").notNull().default(false),
  variancePercent: integer("variance_percent").notNull().default(25),
  peakHoursEnabled: boolean("peak_hours_enabled").notNull().default(true),
  errorMessage: text("error_message"),
  ...timestamps,
});

export const transactionsTable = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 14, scale: 4 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 14, scale: 4 }).notNull(),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  description: text("description"),
  paymentMethod: text("payment_method"),
  paymentReference: text("payment_reference"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supportTicketsTable = pgTable("support_tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  category: text("category").notNull().default("other"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  ...timestamps,
});

export const platformSettingsTable = pgTable("platform_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  description: text("description"),
  ...timestamps,
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({ id: true, userId: true, createdAt: true, updatedAt: true });
export type Profile = typeof profilesTable.$inferSelect;
export type Order = typeof ordersTable.$inferSelect;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;