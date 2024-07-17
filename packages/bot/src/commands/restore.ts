import {
  ActionRowBuilder,
  EmbedBuilder,
  SelectMenuOptionBuilder,
  StringSelectMenuBuilder,
  messageLink,
  time,
} from "@discordjs/builders";
import dedent from "dedent-js";
import {
  APIGuildChannel,
  APIMessage,
  APIWebhook,
  ChannelType,
  GuildChannelType,
  MessageFlags,
  PermissionFlagsBits,
  RouteBases,
  Routes,
} from "discord-api-types/v10";
import { PermissionFlags } from "discord-bitflag";
import { getDb, upsertDiscordUser } from "store";
import { shareLinks } from "store/src/schema/index.js";
import { QueryData } from "store/src/types/backups.js";
import {
  ChatInputAppCommandCallback,
  MessageAppCommandCallback,
} from "../commands.js";
import { AutoComponentCustomId, SelectMenuCallback } from "../components.js";
import { Env } from "../types/env.js";
import { parseAutoComponentId } from "../util/components.js";
import { isThread } from "../util/guards.js";
import { boolEmoji, color } from "../util/meta.js";
import { base64UrlEncode, randomString } from "../util/text.js";
import { getUserTag } from "../util/user.js";
import { resolveMessageLink } from "./components/entry.js";

export const messageToQueryData = (
  ...messages: Pick<
    APIMessage,
    "content" | "embeds" | "components" | "webhook_id" | "attachments"
  >[]
): QueryData => {
  return {
    version: "d2",
    messages: messages.map((msg) => ({
      data: {
        content: msg.content,
        embeds: msg.embeds,
        components: msg.components,
        webhook_id: msg.webhook_id,
        attachments: msg.attachments,
      },
    })),
  };
};

// export const messageToLinkQueryData = (embeds: APIEmbed[]): LinkQueryData => {

//   return {
//     version: 1
//     embed: {
//       data: {
//         author: embed.author,
//         color: embed.color,
//         description: embed.description,
//         images:
//       },
//       redirect_url: embed.url
//     },
//   };
// };

export const getShareEmbed = (
  data: Awaited<ReturnType<typeof createShareLink>>,
  safe?: boolean,
) => {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("Restored message")
    .setDescription(data.url)
    .addFields({
      name: "Expires",
      value: `${time(data.expires, "d")} (${time(data.expires, "R")})`,
      inline: true,
    });
  if (safe !== undefined) {
    embed.addFields({
      name: "Safe",
      value: `${boolEmoji(safe)} ${
        safe
          ? "This link is safe to share - it does not include a webhook URL."
          : "This link **may not be** safe to share - it includes the webhook's URL."
      }`,
      inline: true,
    });
  }
  return embed;
};

export const generateUniqueShortenKey = async (
  kv: KVNamespace,
  length: number,
  tries = 10,
): Promise<{ id: string; key: string }> => {
  for (const _ of Array(tries)) {
    const id = randomString(length);
    const key = `share-${id}`;
    if (!(await kv.get(key))) {
      return { id, key };
    }
  }
  return await generateUniqueShortenKey(kv, length + 1);
};

export const createLongDiscohookUrl = (origin: string, data: QueryData) =>
  `${origin}/?${new URLSearchParams({
    data: base64UrlEncode(JSON.stringify(data)),
  })}`;

export const createShareLink = async (
  env: Env,
  data: QueryData,
  options?: {
    /** Expiration from now in milliseconds */
    ttl?: number;
    userId?: bigint;
    origin?: string;
  },
) => {
  const { userId } = options ?? {};
  const ttl = options?.ttl ?? 604800000;
  const origin = options?.origin ?? env.DISCOHOOK_ORIGIN;
  const expires = new Date(new Date().getTime() + ttl);

  // biome-ignore lint/performance/noDelete: We don't want to store this property at all
  delete data.backup_id;
  const shortened = {
    data: JSON.stringify(data),
    origin,
    userId: userId?.toString(),
  };

  const kv = env.KV;
  const { id, key } = await generateUniqueShortenKey(kv, 8);
  await kv.put(key, JSON.stringify(shortened), {
    expirationTtl: ttl / 1000,
    // KV doesn't seem to provide a way to read `expirationTtl`
    metadata: { expiresAt: new Date(new Date().valueOf() + ttl).toISOString() },
  });
  if (userId) {
    const db = getDb(env.HYPERDRIVE.connectionString);
    await db.insert(shareLinks).values({
      userId,
      shareId: id,
      expiresAt: expires,
      origin: options?.origin,
    });
  }

  return {
    id,
    origin,
    url: `${origin}/?share=${id}`,
    expires,
  };
};

export const restoreMessageEntry: MessageAppCommandCallback = async (ctx) => {
  const user = await upsertDiscordUser(
    getDb(ctx.env.HYPERDRIVE.connectionString),
    ctx.user,
  );
  const message = ctx.getMessage();

  if (!message.webhook_id || message.interaction_metadata) {
    const data = messageToQueryData(message);
    const share = await createShareLink(ctx.env, data, { userId: user.id });
    return ctx.reply({
      embeds: [getShareEmbed(share, true).toJSON()],
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(
      `a_select-restore-options_${user.id}:${message.id}:${
        message.webhook_id ?? ""
      }` satisfies AutoComponentCustomId,
    )
    .setMaxValues(1)
    .addOptions(
      new SelectMenuOptionBuilder()
        .setLabel("Don't include edit options")
        .setDescription("The share link won't show the message's webhook URL")
        .setValue("none")
        .setEmoji({ name: "💬" }),
    );

  if (
    message.webhook_id &&
    ctx.userPermissons.has(PermissionFlagsBits.ManageWebhooks)
  ) {
    select.addOptions(
      new SelectMenuOptionBuilder()
        .setLabel("Include edit options")
        .setDescription("The share link will show the message's webhook URL")
        .setValue("edit")
        .setEmoji({ name: "🔗" }),
    );
  }

  // if (message.embeds && message.embeds.length !== 0) {
  //   select.addOptions(
  //     new SelectMenuOptionBuilder()
  //       .setLabel("[Deluxe] Restore as a link embed")
  //       .setDescription("You will be taken to the link embed editor")
  //       .setValue("link")
  //       .setEmoji({ name: "✨" }),
  //   );
  // }

  return ctx.reply({
    components: [
      new ActionRowBuilder<typeof select>().addComponents(select).toJSON(),
    ],
    flags: MessageFlags.Ephemeral,
  });
};

export const selectRestoreOptionsCallback: SelectMenuCallback = async (ctx) => {
  const { userId, messageId, webhookId } = parseAutoComponentId(
    ctx.interaction.data.custom_id,
    "userId",
    "messageId",
    "webhookId",
  );

  let threadId = [
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ].includes(ctx.interaction.channel.type)
    ? ctx.interaction.channel.id
    : undefined;

  let message: APIMessage | undefined;
  let webhook: APIWebhook | undefined;
  if (webhookId) {
    try {
      webhook = (await ctx.rest.get(Routes.webhook(webhookId))) as APIWebhook;
    } catch {}
    if (webhook?.token) {
      message = (await ctx.rest.get(
        Routes.webhookMessage(webhook.id, webhook.token, messageId),
        {
          query: threadId
            ? new URLSearchParams({ thread_id: threadId })
            : undefined,
        },
      )) as APIMessage;
    }
  }
  if (!message) {
    message = (await ctx.rest.get(
      Routes.channelMessage(ctx.interaction.channel.id, messageId),
    )) as APIMessage;
  }

  const value = (
    ctx.interaction.data.values as ("none" | "edit" | "link")[]
  )[0];
  switch (value) {
    case "none": {
      const data = messageToQueryData(message);
      // url.searchParams.set("data", base64UrlEncode(JSON.stringify(data)))
      const share = await createShareLink(ctx.env, data, {
        userId: BigInt(userId),
      });
      return ctx.updateMessage({
        embeds: [getShareEmbed(share, true).toJSON()],
        components: [],
      });
    }
    case "edit": {
      if (!webhook) {
        return ctx.updateMessage({
          content: "This is not a webhook message.",
          components: [],
        });
      }
      if (!webhook.token) {
        return ctx.updateMessage({
          content: dedent`
            Webhook token (ID ${webhookId}) was not available.
            It may be an incompatible type of webhook, or it may have been
            created by a different bot user.
          `,
          components: [],
        });
      }

      let channel: APIGuildChannel<GuildChannelType> | undefined;
      if (message.channel_id !== webhook.channel_id) {
        if (message.channel_id !== ctx.interaction.channel.id) {
          try {
            channel = (await ctx.rest.get(
              Routes.channel(message.channel_id),
            )) as APIGuildChannel<GuildChannelType>;
          } catch {}
        } else {
          channel = ctx.interaction
            .channel as APIGuildChannel<GuildChannelType>;
        }

        if (channel && isThread(channel)) {
          threadId = channel.id;
        } else if (channel) {
          // The message channel is not a thread, yet it differs from the
          // webhook channel. In this instance, we attempt to move the webhook
          // so that the user can edit the message. I'm afraid that this might
          // be confusing for users who use the same webhook across multiple
          // channels a lot, but if they only use the bot to restore, everything
          // should stay in sync.
          try {
            await ctx.rest.patch(Routes.webhook(webhook.id), {
              body: { channel_id: channel.id },
              reason: `User ${getUserTag(ctx.user)} (${
                ctx.user.id
              }) restored ${messageId} to edit it, but the webhook had to be moved.`.slice(
                0,
                512,
              ),
            });
          } catch {}
        }
      }

      const data = messageToQueryData(message);
      data.messages[0].thread_id = threadId;
      data.messages[0].reference = ctx.interaction.guild_id
        ? messageLink(message.channel_id, message.id, ctx.interaction.guild_id)
        : messageLink(message.channel_id, message.id);

      data.targets = [
        {
          url: `${RouteBases.api}${Routes.webhook(webhook.id, webhook.token)}`,
        },
      ];
      const share = await createShareLink(ctx.env, data, {
        userId: BigInt(userId),
      });
      return ctx.updateMessage({
        embeds: [getShareEmbed(share, false).toJSON()],
        components: [],
      });
    }
    case "link": {
      const url = new URL(ctx.env.DISCOHOOK_ORIGIN);
      break;
    }
    default:
      break;
  }
  return ctx.reply({
    content: "This shouldn't happen!",
    flags: MessageFlags.Ephemeral,
  });
};

export const restoreMessageChatInputCallback: ChatInputAppCommandCallback<
  true
> = async (ctx) => {
  const message = await resolveMessageLink(
    ctx.rest,
    ctx.getStringOption("message").value,
  );
  if (typeof message === "string") {
    return ctx.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
  const mode = (ctx.getStringOption("mode").value || "none") as
    | "none"
    | "edit"
    | "link";

  const user = await upsertDiscordUser(
    getDb(ctx.env.HYPERDRIVE.connectionString),
    ctx.user,
  );
  // if (!userIsPremium(user) && mode === "link") {}
  if (
    mode === "edit" &&
    !ctx.userPermissons.has(PermissionFlags.ManageWebhooks)
  ) {
    return ctx.reply({
      content:
        "You must have the manage webhooks permission to restore a message in edit mode.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const data = messageToQueryData(message);

  if (!message.webhook_id || message.interaction_metadata) {
    const share = await createShareLink(ctx.env, data, { userId: user.id });
    return ctx.reply({
      embeds: [getShareEmbed(share, true).toJSON()],
      flags: MessageFlags.Ephemeral,
    });
  }

  switch (mode) {
    case "none": {
      const data = messageToQueryData(message);
      // url.searchParams.set("data", base64UrlEncode(JSON.stringify(data)))
      const share = await createShareLink(ctx.env, data, {
        userId: BigInt(user.id),
      });
      return ctx.reply({
        embeds: [getShareEmbed(share, true).toJSON()],
        flags: MessageFlags.Ephemeral,
      });
    }
    case "edit": {
      if (!message.webhook_id) {
        return ctx.reply({
          content: "This is not a webhook message.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const webhook = (await ctx.rest.get(
        Routes.webhook(message.webhook_id),
      )) as APIWebhook;
      if (!webhook.token) {
        return ctx.reply({
          content: dedent`
            Webhook token (ID ${message.webhook_id}) was not available.
            It may be an incompatible type of webhook, or it may have been
            created by a different bot user.
          `,
          flags: MessageFlags.Ephemeral,
        });
      }

      let channel: APIGuildChannel<GuildChannelType> | undefined;
      let threadId: string | undefined;
      if (message.channel_id !== webhook.channel_id) {
        if (message.channel_id !== ctx.interaction.channel.id) {
          try {
            channel = (await ctx.rest.get(
              Routes.channel(message.channel_id),
            )) as APIGuildChannel<GuildChannelType>;
          } catch {}
        } else {
          channel = ctx.interaction
            .channel as APIGuildChannel<GuildChannelType>;
        }

        if (channel && isThread(channel)) {
          threadId = channel.id;
        } else if (channel) {
          // See comment in selectRestoreOptionsCallback
          try {
            await ctx.rest.patch(Routes.webhook(webhook.id), {
              body: { channel_id: channel.id },
              reason: `User ${getUserTag(ctx.user)} (${ctx.user.id}) restored ${
                message.id
              } to edit it, but the webhook had to be moved.`.slice(0, 512),
            });
          } catch {}
        }
      }

      data.messages[0].thread_id = threadId;
      data.messages[0].reference = ctx.interaction.guild_id
        ? messageLink(message.channel_id, message.id, ctx.interaction.guild_id)
        : messageLink(message.channel_id, message.id);
      data.targets = [
        {
          url: `${RouteBases.api}${Routes.webhook(webhook.id, webhook.token)}`,
        },
      ];
      const share = await createShareLink(ctx.env, data, {
        userId: user.id,
      });
      return ctx.reply({
        embeds: [getShareEmbed(share, false).toJSON()],
        flags: MessageFlags.Ephemeral,
      });
    }
    case "link": {
      const url = new URL(ctx.env.DISCOHOOK_ORIGIN);
      break;
    }
    default:
      break;
  }

  return ctx.reply({
    content: "This shouldn't happen",
    flags: MessageFlags.Ephemeral,
  });
};
