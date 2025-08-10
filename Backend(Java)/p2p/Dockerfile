FROM openjdk:21-jdk-slim AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
# Build the project, skipping tests to speed up the process
RUN ./mvnw clean install -DskipTests


FROM openjdk:21-jdk-slim
# create and switch to a folder inside the image
WORKDIR /app
# copy the jar into the image
COPY target/Backend-Webrtc-Application.jar app.jar
# expose port
EXPOSE 8080
# run the jar
ENTRYPOINT ["java", "-jar", "app.jar"]