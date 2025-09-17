const Redis = require('ioredis');

class MQClient {
  constructor() {
    // 写入 Redis 连接信息
    this.redisUrl = 'redis://:xxx@xxx@xxx:6379';
    this.pub = null;
    this.sub = null;
    this.handlers = {};
  }

  async connect() {
    if (this.pub && this.sub) return;

    // 分开创建发布和订阅实例
    this.pub = new Redis(this.redisUrl);
    this.sub = new Redis(this.redisUrl);

    this.sub.on('message', (channel, message) => {
      if (this.handlers[channel]) {
        try {
          this.handlers[channel](JSON.parse(message));
        } catch (err) {
          console.error('[MQ] Message handler error:', err);
        }
      }
    });

    this.pub.on('error', (err) => console.error('[MQ] PUB connection error:', err));
    this.sub.on('error', (err) => console.error('[MQ] SUB connection error:', err));

    console.log('[MQ] Connected to Redis at', this.redisUrl);
  }

  async publish(channel, msg) {
    if (!this.pub) await this.connect();
    await this.pub.publish(channel, JSON.stringify(msg));
  }

  async consume(channel, handler) {
    if (!this.sub) await this.connect();
    this.handlers[channel] = handler;
    await this.sub.subscribe(channel);
  }
}

module.exports = MQClient;
