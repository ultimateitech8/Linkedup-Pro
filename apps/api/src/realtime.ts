import type { Server as HttpServer } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import { Server } from 'socket.io';
import { appOrigin, auth, canUseAccount } from './database.js';

let realtime: Server | undefined;

export function attachRealtime(server: HttpServer) {
  const io = new Server(server, { path: '/api/realtime' });
  io.use(async (socket, next) => {
    try {
      const origin = socket.request.headers.origin;
      if (origin && origin !== appOrigin) return next(new Error('Invalid origin'));
      const session = await auth.api.getSession({ headers: fromNodeHeaders(socket.request.headers) });
      if (!session || !canUseAccount(session.user)) return next(new Error('Sign in to connect'));
      socket.data.userId = session.user.id;
      next();
    } catch {
      next(new Error('Could not verify the session'));
    }
  });
  io.on('connection', (socket) => {
    void socket.join(`member:${socket.data.userId}`);
  });
  realtime = io;
}

export function notifyMember(id: string) {
  realtime?.to(`member:${id}`).emit('dashboard:changed');
}
