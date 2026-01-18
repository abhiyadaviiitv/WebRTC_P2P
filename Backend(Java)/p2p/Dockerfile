FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app
COPY pom.xml .
COPY mvnw .
COPY .mvn .mvn
COPY src ./src
RUN chmod +x mvnw
# Build the project, skipping tests to speed up the process
RUN ./mvnw clean install -DskipTests

FROM eclipse-temurin:21-jre-alpine
# create and switch to a folder inside the image
WORKDIR /app
# copy the jar from the build stage
COPY --from=build /app/target/Backend-Webrtc-Application.jar app.jar
# expose port
EXPOSE 8080
# run the jar
ENTRYPOINT ["java", "-jar", "app.jar"]