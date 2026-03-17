FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

RUN adduser --system --no-create-home ape

EXPOSE 7890

USER ape

CMD ["python", "main.py"]
