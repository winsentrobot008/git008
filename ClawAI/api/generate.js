export default async function handler(req, res) {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "请输入内容" });
    }
    // 测试响应
    return res.status(200).json({
      success: true,
      message: "✅ Vercel 接口正常运行",
      input: text
    });
  } catch (e) {
    return res.status(500).json({ error: "服务器错误", msg: e.message });
  }
}
