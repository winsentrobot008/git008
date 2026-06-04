"""
Action 输出 JSON Schema 定义
用于 Grip 验证的结构检查 (jsonschema.validate)

安全规范：纯数据定义，无 API Key。
"""

ANALYZE_MARKET_SCHEMA = {
    "type": "object",
    "required": ["analysis", "score", "trends", "recommendations"],
    "properties": {
        "analysis": {"type": "string", "minLength": 50},
        "score": {"type": "number", "minimum": 0, "maximum": 1},
        "trends": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
        },
        "recommendations": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
        },
    },
}

WRITE_CODE_SCHEMA = {
    "type": "object",
    "required": ["code", "filename", "language", "dependencies"],
    "properties": {
        "code": {"type": "string", "minLength": 20},
        "filename": {
            "type": "string",
            "pattern": r"^[\w\-\.]+\.(py|js|ts|java|html|css)$",
        },
        "language": {
            "type": "string",
            "enum": ["python", "javascript", "typescript", "java", "html", "css"],
        },
        "dependencies": {"type": "array", "items": {"type": "string"}},
    },
}

GENERATE_CONTENT_SCHEMA = {
    "type": "object",
    "required": ["content", "title", "word_count", "format"],
    "properties": {
        "content": {"type": "string", "minLength": 100},
        "title": {"type": "string", "minLength": 5},
        "word_count": {"type": "integer", "minimum": 50},
        "format": {
            "type": "string",
            "enum": ["article", "social_post", "email", "ad"],
        },
    },
}

REVIEW_SCHEMA = {
    "type": "object",
    "required": ["approved", "score", "feedback", "suggestions"],
    "properties": {
        "approved": {"type": "boolean"},
        "score": {"type": "number", "minimum": 0, "maximum": 1},
        "feedback": {"type": "string", "minLength": 20},
        "suggestions": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
}

ACTION_SCHEMAS = {
    "analyze_market": ANALYZE_MARKET_SCHEMA,
    "write_code": WRITE_CODE_SCHEMA,
    "generate_content": GENERATE_CONTENT_SCHEMA,
    "review": REVIEW_SCHEMA,
}