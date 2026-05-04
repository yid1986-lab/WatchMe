services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: watchme
      POSTGRES_PASSWORD: watchme
      POSTGRES_DB: watchme_v2
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres/schema.sql:/docker-entrypoint-initdb.d/001-schema.sql:ro

  redis:
    image: redis:7
    ports:
      - "6379:6379"

volumes:
  postgres_data:
