// Pre-filled emails that open in the colleague's own mail app (Outlook).
import type { Booking, Room } from './types'
import { fmtLongDay, fmtRange, fromIso } from './time'

export function appLink(): string {
  return `${window.location.origin}${window.location.pathname}`
}

function mailto(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

function firstName(name: string | undefined): string {
  return (name ?? '').split(' ')[0] || 'there'
}

function describe(booking: Booking, room: Room | undefined) {
  return {
    room: room?.name ?? 'the room',
    day: fmtLongDay(fromIso(booking.starts_at)),
    time: fmtRange(booking.starts_at, booking.ends_at),
  }
}

export function contactOwnerLink(booking: Booking, room: Room | undefined, myName: string): string {
  const { room: roomName, day, time } = describe(booking, room)
  return mailto(
    booking.owner?.email ?? '',
    `About your booking "${booking.title}" (${roomName}, ${day})`,
    `Hi ${firstName(booking.owner?.full_name)},\n\n` +
      `I saw you booked ${roomName} on ${day} (${time}) for "${booking.title}".\n\n\n\n` +
      `Thanks!\n${myName}`,
  )
}

export function askToSwitchRoomLink(
  booking: Booking,
  room: Room | undefined,
  freeRooms: Room[],
  myName: string,
): string {
  const { room: roomName, day, time } = describe(booking, room)
  const alternative = freeRooms.length
    ? `${freeRooms.map((r) => r.name).join(' or ')} ${freeRooms.length > 1 ? 'are' : 'is'} still free at that time.`
    : 'Unfortunately no other room is free at that time, so maybe another time works for you?'
  return mailto(
    booking.owner?.email ?? '',
    `Could you switch rooms? ${roomName}, ${day} ${time}`,
    `Hi ${firstName(booking.owner?.full_name)},\n\n` +
      `You booked ${roomName} on ${day} (${time}) for "${booking.title}".\n\n` +
      `Would you be willing to switch to another room? ${alternative}\n` +
      `I'd really need ${roomName} because: \n\n` +
      `If that's OK, you can change it in two clicks: open your booking in the room calendar (${appLink()}) → Edit → choose the other room.\n\n` +
      `Thanks a lot!\n${myName}`,
  )
}

export function askForSlotLink(booking: Booking, room: Room | undefined, myName: string): string {
  const { room: roomName, day, time } = describe(booking, room)
  return mailto(
    booking.owner?.email ?? '',
    `Could I use ${roomName} on ${day} (${time})?`,
    `Hi ${firstName(booking.owner?.full_name)},\n\n` +
      `I'd like to use ${roomName} on ${day} (${time}), which you booked for "${booking.title}".\n` +
      `Would you be able to move your meeting to another time or room, or release it if you no longer need it?\n\n` +
      `The room calendar: ${appLink()}\n\n` +
      `Thanks a lot!\n${myName}`,
  )
}
