exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const text = body.text;
    if (!text) {
      return { statusCode:400, body:JSON.stringify({error:"请输入内容"}) };
    }
    return {
      statusCode:200,
      body:JSON.stringify({
        success:true,
        message:"✅ Netlify 接口正常运行",
        input:text
      })
    };
  } catch(e) {
    return { statusCode:500, body:JSON.stringify({error:"服务错误"}) };
  }
};
