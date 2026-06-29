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

DEFINE_REQUIREMENTS_SCHEMA = {
    "type": "object",
    "required": ["mvp_scope", "functional_requirements", "constraints", "success_metrics"],
    "properties": {
        "mvp_scope": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "functional_requirements": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "constraints": {"type": "array", "items": {"type": "string"}},
        "success_metrics": {"type": "array", "items": {"type": "string"}},
    },
}

DESIGN_ARCHITECTURE_SCHEMA = {
    "type": "object",
    "required": ["architecture", "tech_stack", "modules", "data_models"],
    "properties": {
        "architecture": {"type": "string", "minLength": 20},
        "tech_stack": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "modules": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "data_models": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name", "fields"],
                "properties": {
                    "name": {"type": "string"},
                    "fields": {"type": "array", "items": {"type": "string"}},
                },
            },
            "minItems": 1,
        },
    },
}

DESIGN_UI_UX_SCHEMA = {
    "type": "object",
    "required": ["user_flow", "components", "states", "interaction_patterns"],
    "properties": {
        "user_flow": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "components": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "states": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "interaction_patterns": {"type": "array", "items": {"type": "string"}},
    },
}

BUILD_ARTIFACT_SCHEMA = {
    "type": "object",
    "required": ["output_path", "success_status", "build_command", "build_log"],
    "properties": {
        "output_path": {"type": "string", "minLength": 5},
        "success_status": {"type": "boolean"},
        "build_command": {"type": "string", "minLength": 3},
        "build_log": {"type": "string", "minLength": 1},
        "artifact_size_bytes": {"type": "integer", "minimum": 0},
    },
}

ACTION_SCHEMAS = {
    "analyze_market": ANALYZE_MARKET_SCHEMA,
    "define_requirements": DEFINE_REQUIREMENTS_SCHEMA,
    "design_architecture": DESIGN_ARCHITECTURE_SCHEMA,
    "design_ui_ux": DESIGN_UI_UX_SCHEMA,
    "write_code": WRITE_CODE_SCHEMA,
    "build_artifact": BUILD_ARTIFACT_SCHEMA,
    "generate_content": GENERATE_CONTENT_SCHEMA,
    "review": REVIEW_SCHEMA,
}
