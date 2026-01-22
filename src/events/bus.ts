/**
 * Type-safe event bus implementation
 * Pattern inspired by OpenCode's bus system
 *
 * Usage:
 *   import { EventBus } from './events/bus';
 *   import { BridgeConnected } from './events/definitions';
 *
 *   // Subscribe to events
 *   const unsubscribe = EventBus.subscribe(BridgeConnected, (event) => {
 *     console.log('Connected to:', event.properties.url);
 *   });
 *
 *   // Publish events
 *   await EventBus.publish(BridgeConnected, { url: 'wss://...' });
 *
 *   // Cleanup
 *   unsubscribe();
 */

import { z } from 'zod';

/** Event handler function type */
type EventHandler<T> = (event: T) => void | Promise<void>;

/** Internal subscription storage */
const subscriptions = new Map<string, EventHandler<unknown>[]>();

/** Wildcard subscription key */
const WILDCARD = '*';

/** Event definition type */
export interface EventDefinition<Type extends string = string, Props = unknown> {
  type: Type;
  properties: z.ZodType<Props>;
  schema: z.ZodObject<{
    type: z.ZodLiteral<Type>;
    properties: z.ZodType<Props>;
    timestamp: z.ZodNumber;
  }>;
}

/** Event payload type */
export interface EventPayload<Props = unknown> {
  type: string;
  properties: Props;
  timestamp: number;
}

export namespace EventBus {
  /**
   * Define an event type with a schema
   *
   * @param type - Unique event type string (e.g., 'bridge.connected')
   * @param properties - Zod schema for event properties
   * @returns Event definition object
   *
   * @example
   * const MyEvent = EventBus.define('my.event', z.object({
   *   message: z.string(),
   * }));
   */
  export function define<Type extends string, Props extends z.ZodType>(
    type: Type,
    properties: Props
  ): EventDefinition<Type, z.infer<Props>> {
    return {
      type,
      properties,
      schema: z.object({
        type: z.literal(type),
        properties,
        timestamp: z.number(),
      }),
    } as EventDefinition<Type, z.infer<Props>>;
  }

  /**
   * Publish an event to all subscribers
   *
   * @param def - Event definition from define()
   * @param properties - Event properties (validated against schema)
   * @returns Promise that resolves when all handlers complete
   */
  export async function publish<Props>(
    def: EventDefinition<string, Props>,
    properties: Props
  ): Promise<void[]> {
    const payload: EventPayload<Props> = {
      type: def.type,
      properties,
      timestamp: Date.now(),
    };

    const pending: Promise<void>[] = [];

    // Notify specific subscribers
    const specificSubs = subscriptions.get(def.type) ?? [];
    for (const handler of specificSubs) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          pending.push(result.catch((err) => console.error(err)));
        }
      } catch (err) {
        console.error(`[EventBus] Handler error for ${def.type}:`, err);
      }
    }

    // Notify wildcard subscribers
    const wildcardSubs = subscriptions.get(WILDCARD) ?? [];
    for (const handler of wildcardSubs) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          pending.push(result.catch((err) => console.error(err)));
        }
      } catch (err) {
        console.error(`[EventBus] Wildcard handler error:`, err);
      }
    }

    return Promise.all(pending);
  }

  /**
   * Subscribe to an event type
   *
   * @param def - Event definition from define()
   * @param handler - Callback function to handle the event
   * @returns Unsubscribe function
   */
  export function subscribe<Props>(
    def: EventDefinition<string, Props>,
    handler: EventHandler<EventPayload<Props>>
  ): () => void {
    const subs = subscriptions.get(def.type) ?? [];
    subs.push(handler as EventHandler<unknown>);
    subscriptions.set(def.type, subs);

    // Return unsubscribe function
    return () => {
      const currentSubs = subscriptions.get(def.type);
      if (currentSubs) {
        const idx = currentSubs.indexOf(handler as EventHandler<unknown>);
        if (idx !== -1) {
          currentSubs.splice(idx, 1);
        }
      }
    };
  }

  /**
   * Subscribe to all events (wildcard)
   *
   * @param handler - Callback function to handle any event
   * @returns Unsubscribe function
   */
  export function subscribeAll(
    handler: EventHandler<EventPayload<unknown>>
  ): () => void {
    const subs = subscriptions.get(WILDCARD) ?? [];
    subs.push(handler as EventHandler<unknown>);
    subscriptions.set(WILDCARD, subs);

    return () => {
      const currentSubs = subscriptions.get(WILDCARD);
      if (currentSubs) {
        const idx = currentSubs.indexOf(handler as EventHandler<unknown>);
        if (idx !== -1) {
          currentSubs.splice(idx, 1);
        }
      }
    };
  }

  /**
   * Subscribe to an event once (auto-unsubscribes after first event)
   *
   * @param def - Event definition from define()
   * @param handler - Callback function to handle the event
   * @returns Unsubscribe function (can be called to cancel before event fires)
   */
  export function once<Props>(
    def: EventDefinition<string, Props>,
    handler: EventHandler<EventPayload<Props>>
  ): () => void {
    const unsubscribe = subscribe(def, (event) => {
      unsubscribe();
      return handler(event);
    });
    return unsubscribe;
  }

  /**
   * Wait for an event to occur
   *
   * @param def - Event definition to wait for
   * @param timeoutMs - Optional timeout in milliseconds
   * @returns Promise that resolves with the event payload
   */
  export function waitFor<Props>(
    def: EventDefinition<string, Props>,
    timeoutMs?: number
  ): Promise<EventPayload<Props>> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;

      const unsubscribe = once(def, (event) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(event);
      });

      if (timeoutMs !== undefined) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event: ${def.type}`));
        }, timeoutMs);
      }
    });
  }

  /**
   * Get the number of subscribers for an event type
   */
  export function subscriberCount<Props>(def: EventDefinition<string, Props>): number {
    return (subscriptions.get(def.type) ?? []).length;
  }

  /**
   * Clear all subscriptions (useful for testing)
   */
  export function clear(): void {
    subscriptions.clear();
  }

  /**
   * Get all registered event types
   */
  export function getEventTypes(): string[] {
    return Array.from(subscriptions.keys()).filter((k) => k !== WILDCARD);
  }
}
