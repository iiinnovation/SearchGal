export interface PasswordTestCase {
  name: string;
  gameName: string;
  html: string;
  expected: {
    canExtractWithoutExtraPassword: boolean;
    hasPassword: boolean;
    extractedPassword?: string;
    riskType?: 'none' | 'need_contact' | 'need_payment' | 'incomplete' | 'unknown';
  };
}

export const TEST_SAMPLES: PasswordTestCase[] = [
  {
    name: '无密码免密资源',
    gameName: '心跳文学部',
    html: `
      <html>
        <head><title>心跳文学部 官方中文免安装版</title></head>
        <body>
          <div class="content">
            <h1>心跳文学部 Plus</h1>
            <p>游戏已经解压打包好，绿色免安装，下载后双击运行即可，无任何解压密码！</p>
            <a href="http://example.com/ddlc.zip">点击直接下载</a>
          </div>
        </body>
      </html>
    `,
    expected: {
      canExtractWithoutExtraPassword: true,
      hasPassword: false,
      riskType: 'none',
    },
  },
  {
    name: '公开明文解压密码',
    gameName: '白色相簿2',
    html: `
      <html>
        <body>
          <article class="post">
            <h2>白色相簿2 终章 汉化版</h2>
            <div class="meta">发布时间：2026-01-01</div>
            <p>资源包含游戏本体与全CG存档。</p>
            <p>【解压密码】：终点_galgame</p>
            <p><a href="http://example.com/wa2.rar">电信下载地址</a></p>
          </article>
        </body>
      </html>
    `,
    expected: {
      canExtractWithoutExtraPassword: true,
      hasPassword: true,
      extractedPassword: '终点_galgame',
      riskType: 'none',
    },
  },
  {
    name: 'QQ群引流障碍密码',
    gameName: 'CLANNAD',
    html: `
      <html>
        <body>
          <div class="entry">
            <h2>CLANNAD 高清重制版</h2>
            <p>压缩包已添加加密保护防止失效。</p>
            <p class="notice">解压密码请加入交流群：987654321，进群看群置顶公告回复获得密码！私聊不回。</p>
            <a href="http://example.com/clannad.zip">高速通道</a>
          </div>
        </body>
      </html>
    `,
    expected: {
      canExtractWithoutExtraPassword: false,
      hasPassword: true,
      riskType: 'need_contact',
    },
  },
  {
    name: '付费赞助障碍密码',
    gameName: '命运石之门',
    html: `
      <html>
        <body>
          <div class="post-content">
            <h2>命运石之门 0 繁简中文</h2>
            <p>本站独家汉化压制，本资源需赞助本站 VIP 会员方可查看解压密码。</p>
            <a href="/vip-pay">立即赞助获取密码</a>
            <a href="http://example.com/sg0.7z">网盘下载</a>
          </div>
        </body>
      </html>
    `,
    expected: {
      canExtractWithoutExtraPassword: false,
      hasPassword: true,
      riskType: 'need_payment',
    },
  },
];
