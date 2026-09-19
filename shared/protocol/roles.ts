// Roles and permissions as DATA only (PROTOCOL.md §3).
// There is deliberately no authorization logic here: the server implements
// enforcement later, using these tables.

import type { ClientMessageType, ServerMessageType } from "./messages.js";

export const ROLES = ["screen", "admin", "driver", "booster"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = ["STEER", "BOOST", "CONTROL"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions reported to the client in WELCOME.permissions. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  screen: [],
  admin: ["CONTROL"],
  driver: ["STEER"],
  booster: ["BOOST"],
};

/** Client → Server message types each role may send. Anything else → NOT_AUTHORIZED. */
export const ROLE_MAY_SEND: Record<Role, readonly ClientMessageType[]> = {
  screen: ["HELLO", "PING"],
  admin: ["HELLO", "PING", "CONTROL"],
  driver: ["HELLO", "PING", "DRIVER_STEER"],
  booster: ["HELLO", "PING", "BOOST"],
};

const ALL_BROADCASTS = [
  "RACE_STATE",
  "BOOST",
  "TEAM_ACTIVITY",
  "MEME_EVENT",
  "DRIVER_STEER",
] as const satisfies readonly ServerMessageType[];

const PHONE_BROADCASTS = [
  "RACE_STATE",
  "TEAM_ACTIVITY",
  "MEME_EVENT",
] as const satisfies readonly ServerMessageType[];

/** Server → Client broadcast types each role receives (replies like WELCOME/ERROR/PONG go to the sender only). */
export const ROLE_RECEIVES: Record<Role, readonly ServerMessageType[]> = {
  screen: ALL_BROADCASTS,
  admin: ALL_BROADCASTS,
  driver: PHONE_BROADCASTS,
  booster: PHONE_BROADCASTS,
};
