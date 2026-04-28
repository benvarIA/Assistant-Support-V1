<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN">
  <Appenders>
    <RollingFile name="AppLog"
                 fileName="/var/iobeya/logs/iobeya.log"
                 filePattern="/var/iobeya/logs/iobeya-%d{yyyy-MM-dd}-%i.log.gz">
      <PatternLayout pattern="%d{ISO8601} %-5p [%t] %c - %m%n"/>
      <Policies>
        <TimeBasedTriggeringPolicy/>
        <SizeBasedTriggeringPolicy size="100 MB"/>
      </Policies>
      <DefaultRolloverStrategy max="14"/>
    </RollingFile>
    <Console name="Console" target="SYSTEM_OUT">
      <PatternLayout pattern="%d{ISO8601} %-5p [%t] %c - %m%n"/>
    </Console>
  </Appenders>
  <Loggers>
    <Root level="info">
      <AppenderRef ref="AppLog"/>
      <AppenderRef ref="Console"/>
    </Root>
  </Loggers>
</Configuration>
