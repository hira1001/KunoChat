import WebSocket from 'ws';

const ws = new WebSocket('ws://192.168.64.76:8787');

ws.on('open', () => {
  console.log('Successfully connected to signaling server!');
  ws.close();
});

ws.on('error', (err) => {
  console.error('Failed to connect to signaling server:', err);
});
